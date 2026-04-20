/**
 * Single entry point for paste operations. Parses the clipboard, picks a
 * strategy (inline vs structural), looks up the target block's
 * PasteSurface, invokes the appropriate hook to get a pure data result,
 * and routes the mutation through the existing mutation APIs (top-level
 * `BlockEditActions` or nested `BlockListState.commitChildrenEdit`).
 *
 * Surfaces are stateless — they transform (node, offset, text/blocks)
 * into result data. This module owns parsing, strategy selection,
 * mutation routing, and focus landing so surface authors never need to
 * understand the reactive / undo architecture.
 *
 * Inline paste is special: the target block's own reactive rendering
 * pipeline is responsible for cursor placement via `pendingCursorOffset`.
 * The dispatcher returns the caret offset so the caller can set
 * `pendingCursorOffset` synchronously alongside the raw mutation, keeping
 * both writes in a single Svelte reactivity flush. Cross-block inline
 * paste (skipSnapshot) bypasses updateBlockContent entirely and uses
 * DOM-level focus because the originating block's pendingCursorOffset
 * may address a block that's about to be unmounted by the range delete.
 */

import { tick } from 'svelte';
import type { BlockKind, CstNode, Document } from '../core/nodes';
import type { BlockEditActions } from '../contracts';
import { CURSOR_END } from '../contracts';
import { parse } from '../core/parser';
import { trimTrailingLineEnding } from '../core/lines';
import { isProseKind, parseInline, getContentRange } from '../core/inline';
import { buildPastedReplacement } from './paste-replacement';
import { nodeAt } from './node-ops';
import { rebuildContainerRawIfContainer } from './container-raw';
import { generateBlockId } from './block-id';
import { getStateForNode } from '../components/blocks/container-state/state-registry';
import {
	registerPasteSurface,
	getPasteSurface,
	type PasteSurface,
	type PasteRange,
	type InlinePasteResult,
	type StructuralPasteResult
} from './paste-surfaces';

// ── Public API ─────────────────────────────────────────────────────────────

export type PasteStrategy = 'inline' | 'structural';

export interface PasteDispatchInput {
	/** Raw clipboard text. */
	pastedText: string;
	/** Path from Document root to the target node. Length ≥ 1. */
	targetPath: number[];
	/** Caret offset within the target node's raw. */
	offset: number;
	/** Selection range within the target's raw (not cross-block). */
	preDelete?: PasteRange;
}

export interface PasteDispatchContext {
	doc: Document;
	/** Action bundle for the target's level (top-level or nested). Used
	 * for single-block paste to route updates through updateBlockContent
	 * / replaceBlock. Not used in cross-block (skipSnapshot) mode because
	 * the originating block's bundle may not match the target's level. */
	blockEdit: BlockEditActions;
	/** Skip pushing an undo snapshot and bypass updateBlockContent's
	 * debounce. Set by cross-block callers that already pushed a
	 * snapshot via beginContainerEdit. */
	skipSnapshot?: boolean;
}

export interface PasteDispatchResult {
	/** For inline paste: caret offset to restore after the raw mutation
	 * settles. Callers should:
	 * - Single-block: set the block's `pendingCursorOffset` to this value
	 *   synchronously with the updateBlockContent call (so both land in
	 *   one reactive flush).
	 * - Cross-block: use for DOM-level caret restoration via
	 *   applyCollapsedCaret + el.focus() after awaiting reactivity.
	 * Undefined for structural paste — focus is handled internally. */
	inlineCaretOffset?: number;
}

/**
 * Execute a paste at the specified target position. Parses the clipboard,
 * picks inline vs structural based on the parsed shape, looks up the
 * target's PasteSurface, and routes the resulting mutation.
 */
export async function pasteDispatch(
	input: PasteDispatchInput,
	ctx: PasteDispatchContext
): Promise<PasteDispatchResult> {
	if (!input.pastedText) return {};

	const parsed = parse(input.pastedText);
	if (parsed.children.length === 0) return {};

	const targetNode = nodeAt(ctx.doc, input.targetPath) as CstNode | null;
	if (!targetNode) return {};

	// ── Container-matching unwrap ─────────────────────────────────────────
	// When the clipboard is a single list/blockquote of kind K and an
	// ancestor of the target is also kind K (with matching ordered flag
	// for lists), AND the target's immediate descendant of that ancestor
	// is empty (e.g. a list-item whose content was deleted by a preceding
	// cross-block range delete), unwrap the pasted container and splice
	// its items into the matching ancestor — replacing the empty
	// descendant. This makes Ctrl+C → Ctrl+V round-trips within a list
	// preserve structure instead of producing a nested sub-list.
	const unwrap = findContainerMatchingUnwrap(ctx.doc, input.targetPath, parsed);
	if (unwrap) {
		await applyContainerMatchingPaste(unwrap, ctx);
		return {};
	}

	const surface = getPasteSurface(targetNode.kind);
	const clipboardStrategy = pickPasteStrategy(parsed);

	// A surface that explicitly omits `onStructuralPaste` (e.g. the code
	// block surface) opts out of structural paste entirely — all paste
	// becomes literal text via the inline hook, regardless of clipboard
	// shape. This is the right behavior for surfaces where pasted
	// markdown should stay verbatim (code blocks treat "```" on the
	// clipboard as body text, not a fence).
	const surfaceForcesInline = surface !== undefined && surface.onStructuralPaste === undefined;
	const strategy: PasteStrategy = surfaceForcesInline ? 'inline' : clipboardStrategy;

	if (strategy === 'inline') {
		const hook = surface?.onInlinePaste ?? defaultInlineHook;
		const result = hook(targetNode, input.offset, input.pastedText, input.preDelete);
		applyInlineResult(input.targetPath, result, ctx);
		return { inlineCaretOffset: result.caretOffset };
	}

	const hook = surface?.onStructuralPaste ?? defaultStructuralHook;
	const blocks = materializeBlankLines(parsed.children);
	const result = hook(targetNode, input.offset, blocks, input.preDelete);
	await applyStructuralResult(input.targetPath, result, ctx);
	return {};
}

/**
 * Convert blank-line trivia on top-level pasted blocks into explicit
 * empty-paragraph blocks. Keyboard typing (Enter-Enter) produces an empty
 * paragraph block that renders as a visible blank-line row; the parser
 * collapses the same semantic into `leadingTrivia` on the following block
 * (which serializes the same but doesn't render as a visible row). Without
 * this normalization, pasting content like "one\n\ntwo" produces two
 * blocks visually touching, while typing the same content shows a blank
 * line — same serialized source, different rendered structure.
 *
 * Rule: for each block after the first whose leadingTrivia contains N
 * newlines (N >= 1 indicates a blank line preceded), prepend N empty
 * paragraph blocks and clear the trivia. Non-recursive — only applies to
 * the top-level block sequence, not nested container children (list
 * items don't carry blank-line semantics in their own trivia).
 */
function materializeBlankLines(blocks: CstNode[]): CstNode[] {
	if (blocks.length <= 1) return blocks;
	const out: CstNode[] = [blocks[0]];
	for (let i = 1; i < blocks.length; i++) {
		const block = blocks[i];
		const trivia = block.leadingTrivia ?? '';
		const newlineCount = (trivia.match(/\n/g) ?? []).length;
		if (newlineCount >= 1) {
			for (let j = 0; j < newlineCount; j++) {
				out.push({ kind: 'paragraph', leadingTrivia: '', raw: '\n' });
			}
			out.push({ ...block, leadingTrivia: '' });
		} else {
			out.push(block);
		}
	}
	return out;
}

/** Parse a parsed-document shape into the dispatch strategy. */
export function pickPasteStrategy(parsed: Document): PasteStrategy {
	if (parsed.children.length === 1 && parsed.children[0].kind === 'paragraph') {
		return 'inline';
	}
	return 'structural';
}

// ── Default hooks ──────────────────────────────────────────────────────────

/**
 * Default inline hook — splice text (optionally after preDelete) into raw
 * at offset. Used by any surface that doesn't supply its own
 * `onInlinePaste`.
 */
export function defaultInlineHook(
	node: CstNode,
	offset: number,
	text: string,
	preDelete?: PasteRange
): InlinePasteResult {
	const display = trimTrailingLineEnding(node.raw);
	const lineEnding = node.raw.endsWith('\r\n') ? '\r\n' : '\n';

	let effectiveDisplay = display;
	let effectiveOffset = offset;
	if (preDelete && preDelete.start < preDelete.end) {
		effectiveDisplay = display.slice(0, preDelete.start) + display.slice(preDelete.end);
		effectiveOffset = preDelete.start;
	}

	const newDisplay =
		effectiveDisplay.slice(0, effectiveOffset) + text + effectiveDisplay.slice(effectiveOffset);

	return {
		newRaw: newDisplay + lineEnding,
		caretOffset: effectiveOffset + text.length
	};
}

/**
 * Default structural hook — delegate to `buildPastedReplacement`. Used by
 * any surface that doesn't supply its own `onStructuralPaste`.
 */
export function defaultStructuralHook(
	node: CstNode,
	offset: number,
	blocks: CstNode[],
	preDelete?: PasteRange
): StructuralPasteResult {
	let synthLeaf = node;
	let effectiveOffset = offset;
	if (preDelete && preDelete.start < preDelete.end) {
		const display = trimTrailingLineEnding(node.raw);
		const lineEnding = node.raw.endsWith('\r\n') ? '\r\n' : '\n';
		const effectiveRaw =
			display.slice(0, preDelete.start) + display.slice(preDelete.end) + lineEnding;
		synthLeaf = { ...node, raw: effectiveRaw };
		effectiveOffset = preDelete.start;
	}

	const replacement = buildPastedReplacement(synthLeaf, effectiveOffset, blocks);
	return {
		replacement,
		focusReplacementIndex: replacement.length - 1,
		focusOffset: CURSOR_END
	};
}

// ── Default surface registration ───────────────────────────────────────────

// Every inline-capable kind shares paste semantics unless a kind-specific
// surface (e.g. code-paste-surface) registers over the default. The list
// is the source of truth for WHICH kinds register a default surface at
// module load (the descriptor registry is built at the same module-load
// phase, so iterating the registry here would be ordering-hazardous).
// Adding a new inline-capable block kind: add it here AND set
// supportsInline: true on its descriptor in block-kind-descriptor.ts.
const INLINE_CAPABLE_KINDS: BlockKind[] = ['paragraph', 'heading', 'setextHeading'];

for (const kind of INLINE_CAPABLE_KINDS) {
	registerPasteSurface({
		kind,
		onInlinePaste: defaultInlineHook,
		onStructuralPaste: defaultStructuralHook
	});
}

/** Test-only: produce a default text surface descriptor (for unit tests). */
export function __getDefaultTextSurface(kind: PasteSurface['kind']): PasteSurface {
	return {
		kind,
		onInlinePaste: defaultInlineHook,
		onStructuralPaste: defaultStructuralHook
	};
}

// ── Mutation routing ───────────────────────────────────────────────────────

/**
 * Apply an inline paste synchronously. For single-block paste, routes
 * through the target's own `updateBlockContent` (which handles snapshot,
 * inline re-parse, and kind-change focus). For cross-block paste
 * (skipSnapshot), mutates raw directly because the originating bundle
 * may not match the target's level.
 *
 * Intentionally synchronous (no `await`): the caller must set cursor
 * state (`pendingCursorOffset` for single-block, DOM caret for
 * cross-block) before the first Svelte reactivity flush, so this
 * function returns before any microtask boundary.
 */
function applyInlineResult(
	targetPath: number[],
	result: InlinePasteResult,
	ctx: PasteDispatchContext
): void {
	if (ctx.skipSnapshot) {
		// Cross-block: caller owns snapshot bracket. Mutate raw, re-parse
		// inline for prose kinds, rebuild ancestry so container raw
		// reflects the change. Caller awaits reactivity and restores
		// DOM caret.
		const targetNode = nodeAt(ctx.doc, targetPath) as CstNode | null;
		if (!targetNode) return;
		targetNode.raw = result.newRaw;
		if (isProseKind(targetNode.kind)) {
			const range = getContentRange(targetNode);
			targetNode.inlineContent = parseInline(targetNode.raw, range.start, range.end);
		}
		if (targetPath.length >= 2) {
			rebuildAncestryForLeaf(ctx.doc, targetPath);
		}
		return;
	}

	// Single-block inline paste: target is the originating block, so
	// ctx.blockEdit is its own bundle (top-level or nested via Svelte
	// context walking). updateBlockContent handles snapshot +
	// inline re-parse + kind-change focus. Called unawaited — the sync
	// side effects (raw mutation via performUpdate, snapshot debounce)
	// fire immediately, and the caller sets pendingCursorOffset next in
	// the same synchronous block so both land in one reactive flush.
	const blockIndex = targetPath[targetPath.length - 1];
	ctx.blockEdit.updateBlockContent(blockIndex, result.newRaw, result.caretOffset);
}

async function applyStructuralResult(
	targetPath: number[],
	result: StructuralPasteResult,
	ctx: PasteDispatchContext
): Promise<void> {
	if (targetPath.length === 1) {
		const index = targetPath[0];
		await ctx.blockEdit.replaceBlock(
			index,
			result.replacement,
			{
				replacementIndex: result.focusReplacementIndex,
				offset: result.focusOffset
			},
			{ skipSnapshot: ctx.skipSnapshot }
		);
		return;
	}

	// Nested structural: splice through the parent container's
	// BlockListState so ids/refs stay aligned (same as the 0.5.1
	// registry-rewritten path).
	const parentPath = targetPath.slice(0, -1);
	const parent = nodeAt(ctx.doc, parentPath) as CstNode | null;
	const innerIndex = targetPath[targetPath.length - 1];
	if (!parent?.children || innerIndex < 0 || innerIndex >= parent.children.length) return;

	const parentState = getStateForNode(parent)!;
	parentState.commitChildrenEdit((children, ids, refs) => {
		children.splice(innerIndex, 1, ...result.replacement);
		ids.splice(innerIndex, 1, ...result.replacement.map(() => generateBlockId()));
		refs.splice(innerIndex, 1, ...new Array(result.replacement.length).fill(undefined));
	});
	rebuildAncestryForLeaf(ctx.doc, [...parentPath, innerIndex]);
	await tick();

	const lastIdx = innerIndex + result.focusReplacementIndex;
	parentState.innerBlockRefs[lastIdx]?.focus(result.focusOffset);
}

function rebuildAncestryForLeaf(doc: Document, leafPath: number[]): void {
	for (let depth = leafPath.length - 1; depth >= 1; depth--) {
		const ancestor = nodeAt(doc, leafPath.slice(0, depth));
		if (!ancestor || !('kind' in ancestor)) break;
		rebuildContainerRawIfContainer(ancestor as CstNode);
	}
}

// ── Container-matching unwrap ────────────────────────────────────────────

interface ContainerUnwrap {
	/** Path to the matching outer container (list or blockquote). */
	outerPath: number[];
	/** Index within outerPath.children of the empty descendant to replace. */
	spliceIndex: number;
	/** Items from the clipboard's top-level container, to splice in. */
	items: CstNode[];
}

/**
 * Detect whether a paste should be flattened into a matching ancestor
 * container. Returns null if no rewrite applies; otherwise returns the
 * splice target. Only fires when the empty-descendant condition is met,
 * so non-empty targets keep the standard nested-paste behavior.
 */
function findContainerMatchingUnwrap(
	doc: Document,
	targetPath: number[],
	parsed: Document
): ContainerUnwrap | null {
	if (parsed.children.length !== 1) return null;
	const topBlock = parsed.children[0];
	if (topBlock.kind !== 'list' && topBlock.kind !== 'blockquote') return null;
	if (!topBlock.children || topBlock.children.length === 0) return null;

	for (let depth = targetPath.length - 1; depth >= 1; depth--) {
		const ancestorPath = targetPath.slice(0, depth);
		const ancestor = nodeAt(doc, ancestorPath) as CstNode | null;
		if (!ancestor) break;
		if (ancestor.kind !== topBlock.kind) continue;

		if (topBlock.kind === 'list') {
			const ancOrd = (ancestor.metadata as { ordered?: boolean } | undefined)?.ordered;
			const topOrd = (topBlock.metadata as { ordered?: boolean } | undefined)?.ordered;
			if (ancOrd !== topOrd) continue;
		}

		const spliceIndex = targetPath[depth];
		const targetChild = ancestor.children?.[spliceIndex];
		if (!targetChild) continue;
		// Only unwrap when the target's immediate container-child is
		// empty. Non-empty targets retain the nested-paste behavior to
		// avoid surprising users who deliberately paste inside a
		// partially-filled item.
		if (!isEmptyContainerChild(targetChild)) return null;

		return {
			outerPath: ancestorPath,
			spliceIndex,
			items: topBlock.children
		};
	}
	return null;
}

/** Empty in the "cross-block delete just cleared this" sense: one leaf
 * child whose raw has no visible content. */
function isEmptyContainerChild(node: CstNode): boolean {
	if (!node.children || node.children.length === 0) return true;
	if (node.children.length !== 1) return false;
	const c = node.children[0];
	if (c.kind !== 'paragraph') return false;
	return c.raw.trim() === '';
}

async function applyContainerMatchingPaste(
	unwrap: ContainerUnwrap,
	ctx: PasteDispatchContext
): Promise<void> {
	const outer = nodeAt(ctx.doc, unwrap.outerPath) as CstNode | null;
	if (!outer) return;
	const outerState = getStateForNode(outer);
	if (!outerState) return;

	outerState.commitChildrenEdit((children, ids, refs) => {
		children.splice(unwrap.spliceIndex, 1, ...unwrap.items);
		ids.splice(unwrap.spliceIndex, 1, ...unwrap.items.map(() => generateBlockId()));
		refs.splice(unwrap.spliceIndex, 1, ...new Array(unwrap.items.length).fill(undefined));
	});

	// Rebuild the outer container's raw (and any enclosing ancestors)
	// from the newly-spliced children.
	const lastInsertedIdx = unwrap.spliceIndex + unwrap.items.length - 1;
	rebuildAncestryForLeaf(ctx.doc, [...unwrap.outerPath, lastInsertedIdx]);
	await tick();

	// Focus lands at the end of the last inserted item — matches the
	// structural-paste convention elsewhere.
	outerState.innerBlockRefs[lastInsertedIdx]?.focus(CURSOR_END);
}
