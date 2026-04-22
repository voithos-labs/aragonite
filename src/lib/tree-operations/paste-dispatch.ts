/**
 * Single entry point for paste. Parses the clipboard, picks inline vs
 * structural, looks up the target's PasteSurface, and routes the mutation.
 * Surfaces are stateless data transforms; this module owns parsing,
 * strategy selection, mutation routing, and focus landing.
 *
 * Cross-block inline paste (skipSnapshot) bypasses updateBlockContent and
 * uses DOM-level focus because the originating block's pendingCursorOffset
 * may address a block about to be unmounted by the range delete.
 */

import { tick } from 'svelte';
import type { UndoController } from '../components/editor-actions/deps';
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
	/** Action bundle for the target's level. Not used in cross-block (skipSnapshot) mode. */
	blockEdit: BlockEditActions;
	/** Undo controller — required for migrated multi-scope commit sites (Tasks 3 + 5). */
	controller: UndoController;
	/** Skip undo snapshot + updateBlockContent debounce. Cross-block callers push the snapshot themselves. */
	skipSnapshot?: boolean;
}

export interface PasteDispatchResult {
	/**
	 * Inline-paste caret offset. Single-block callers set `pendingCursorOffset`
	 * synchronously with the raw mutation so both land in one reactive flush;
	 * cross-block callers restore the DOM caret after reactivity settles.
	 * Undefined for structural paste (focus handled internally).
	 */
	inlineCaretOffset?: number;
}

/** Execute a paste at the specified target position. */
export async function pasteDispatch(
	input: PasteDispatchInput,
	ctx: PasteDispatchContext
): Promise<PasteDispatchResult> {
	if (!input.pastedText) return {};

	const parsed = parse(input.pastedText);
	if (parsed.children.length === 0) return {};

	const targetNode = nodeAt(ctx.doc, input.targetPath) as CstNode | null;
	if (!targetNode) return {};

	// Container-matching unwrap: when the clipboard is a list/blockquote of
	// kind K and an ancestor is also K (matching ordered flag), splice items
	// into the matching ancestor instead of nesting a sub-container.
	const unwrap = findContainerMatchingUnwrap(
		ctx.doc,
		input.targetPath,
		input.offset,
		parsed,
		ctx.skipSnapshot === true
	);
	if (unwrap) {
		await applyContainerMatchingPaste(unwrap, ctx);
		return {};
	}

	const surface = getPasteSurface(targetNode.kind);
	const clipboardStrategy = pickPasteStrategy(parsed);

	// Surfaces that omit `onStructuralPaste` (e.g. code blocks) force all
	// paste into the inline hook so markdown stays verbatim.
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
 * Convert blank-line trivia into explicit empty-paragraph blocks so pasted
 * "one\n\ntwo" renders the same visible blank-line row that typing the same
 * source produces. The parser collapses blank lines into leadingTrivia,
 * which serializes the same but doesn't render as a row. Top-level only —
 * list items don't carry blank-line semantics in their own trivia.
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

export function pickPasteStrategy(parsed: Document): PasteStrategy {
	if (parsed.children.length === 1 && parsed.children[0].kind === 'paragraph') {
		return 'inline';
	}
	return 'structural';
}

// ── Default hooks ──────────────────────────────────────────────────────────

/** Splice `text` into `node.raw` at `offset` (after optional preDelete). */
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

/** Delegate to `buildPastedReplacement`. */
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

// Adding a new inline-capable block kind: add it here AND set
// supportsInline: true on its descriptor in block-kind-descriptor.ts.
// (Iterating the registry at module load is ordering-hazardous.)
const INLINE_CAPABLE_KINDS: BlockKind[] = ['paragraph', 'heading', 'setextHeading'];

for (const kind of INLINE_CAPABLE_KINDS) {
	registerPasteSurface({
		kind,
		onInlinePaste: defaultInlineHook,
		onStructuralPaste: defaultStructuralHook
	});
}

/** Test-only: produce a default text surface descriptor. */
export function __getDefaultTextSurface(kind: PasteSurface['kind']): PasteSurface {
	return {
		kind,
		onInlinePaste: defaultInlineHook,
		onStructuralPaste: defaultStructuralHook
	};
}

// ── Mutation routing ───────────────────────────────────────────────────────

/**
 * Apply an inline paste. Single-block routes through updateBlockContent
 * (snapshot + inline re-parse + kind-change focus); cross-block mutates raw
 * directly because the originating bundle may not match the target's level.
 *
 * Intentionally synchronous: the caller must set cursor state before the
 * first Svelte reactivity flush, so we return before any microtask boundary.
 */
function applyInlineResult(
	targetPath: number[],
	result: InlinePasteResult,
	ctx: PasteDispatchContext
): void {
	if (ctx.skipSnapshot) {
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

	// Unawaited: the caller sets pendingCursorOffset in the same synchronous
	// block so both land in one reactive flush.
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

	// Nested: splice through the parent's BlockListState so ids/refs stay aligned.
	const parentPath = targetPath.slice(0, -1);
	const parent = nodeAt(ctx.doc, parentPath) as CstNode | null;
	const innerIndex = targetPath[targetPath.length - 1];
	if (!parent?.children || innerIndex < 0 || innerIndex >= parent.children.length) return;

	const parentState = getStateForNode(parent)!;

	await ctx.controller.commitMultiScope(
		[{ node: parent, state: parentState }],
		ctx.skipSnapshot ? 'skip' : { blockIndex: targetPath[0], offset: 0 },
		(scopeChildren) => {
			const children = scopeChildren[0].children;
			children.splice(innerIndex, 1, ...result.replacement);
			// Sync before rebuild — rebuildAncestryForLeaf reads node.children directly.
			parent.children = children;
			rebuildAncestryForLeaf(ctx.doc, [...parentPath, innerIndex]);
			return [
				{
					op: 'replace',
					at: innerIndex,
					count: 1,
					newCount: result.replacement.length
				}
			];
		},
		{
			kind: 'replaceBlock',
			detail: { source: 'paste-dispatch', path: targetPath },
			eventPath: targetPath
		},
		() => {
			const lastIdx = innerIndex + result.focusReplacementIndex;
			parentState.innerBlockRefs[lastIdx]?.focus(result.focusOffset);
		}
	);
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
	outerPath: number[];
	/** Index within outer.children of the target descendant. */
	spliceIndex: number;
	items: CstNode[];
	/**
	 * Non-empty-target variant: merge the first clipboard item's content
	 * into the target leaf at `offset`, splice the rest as siblings, and
	 * reattach post-caret residue to the last spliced item. Absent means
	 * the descendant is empty and gets replaced wholesale.
	 */
	merge?: {
		targetLeafPath: number[];
		offset: number;
	};
}

/**
 * Detect whether to flatten the paste into a matching ancestor container.
 * Empty target descendants always unwrap. Non-empty targets unwrap only in
 * cross-block context (post-range-delete), so single-block pastes into a
 * partially-filled item keep the nested-sub-container behavior.
 */
function findContainerMatchingUnwrap(
	doc: Document,
	targetPath: number[],
	offset: number,
	parsed: Document,
	crossBlockContext: boolean
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

		if (isEmptyContainerChild(targetChild)) {
			return { outerPath: ancestorPath, spliceIndex, items: topBlock.children };
		}

		// Non-empty unwrap requires single-paragraph first/last items —
		// otherwise merge-first / trailing-residue semantics aren't well-defined.
		if (!crossBlockContext) return null;
		if (!hasSingleParagraphChild(topBlock.children[0])) return null;
		if (!hasSingleParagraphChild(topBlock.children[topBlock.children.length - 1])) return null;

		return {
			outerPath: ancestorPath,
			spliceIndex,
			items: topBlock.children,
			merge: { targetLeafPath: targetPath, offset }
		};
	}
	return null;
}

/** One leaf child whose raw has no visible content (post-cross-block-delete stub). */
function isEmptyContainerChild(node: CstNode): boolean {
	if (!node.children || node.children.length === 0) return true;
	if (node.children.length !== 1) return false;
	const c = node.children[0];
	if (c.kind !== 'paragraph') return false;
	return c.raw.trim() === '';
}

function hasSingleParagraphChild(node: CstNode): boolean {
	return !!node.children && node.children.length === 1 && node.children[0].kind === 'paragraph';
}

async function applyContainerMatchingPaste(
	unwrap: ContainerUnwrap,
	ctx: PasteDispatchContext
): Promise<void> {
	const outer = nodeAt(ctx.doc, unwrap.outerPath) as CstNode | null;
	if (!outer) return;
	const outerState = getStateForNode(outer);
	if (!outerState) return;

	if (unwrap.merge) {
		await applyContainerMatchingMerge(unwrap, unwrap.merge, outer, outerState, ctx);
		return;
	}

	// TODO: migrate via multi-scope commit primitive
	outerState.commitChildrenEdit((children, ids, refs) => {
		children.splice(unwrap.spliceIndex, 1, ...unwrap.items);
		ids.splice(unwrap.spliceIndex, 1, ...unwrap.items.map(() => generateBlockId()));
		refs.splice(unwrap.spliceIndex, 1, ...new Array(unwrap.items.length).fill(undefined));
	});

	const lastInsertedIdx = unwrap.spliceIndex + unwrap.items.length - 1;
	rebuildAncestryForLeaf(ctx.doc, [...unwrap.outerPath, lastInsertedIdx]);
	await tick();

	outerState.innerBlockRefs[lastInsertedIdx]?.focus(CURSOR_END);
}

/**
 * Non-empty-target path: merge first item's content into the target leaf
 * at the caret, splice remaining items as siblings, reattach post-caret
 * residue to the last spliced item. Single-item clipboards keep everything
 * in the target leaf.
 */
async function applyContainerMatchingMerge(
	unwrap: ContainerUnwrap,
	merge: NonNullable<ContainerUnwrap['merge']>,
	outer: CstNode,
	outerState: NonNullable<ReturnType<typeof getStateForNode>>,
	ctx: PasteDispatchContext
): Promise<void> {
	const targetLeaf = nodeAt(ctx.doc, merge.targetLeafPath) as CstNode | null;
	if (!targetLeaf) return;

	const firstItem = unwrap.items[0];
	const firstLeaf = firstItem.children?.[0];
	if (!firstLeaf) return;

	const targetLineEnding = targetLeaf.raw.endsWith('\r\n') ? '\r\n' : '\n';
	const targetDisplay = trimTrailingLineEnding(targetLeaf.raw);
	const displayBefore = targetDisplay.slice(0, merge.offset);
	const displayAfter = targetDisplay.slice(merge.offset);
	const firstItemText = trimTrailingLineEnding(firstLeaf.raw);

	const remainingItems = unwrap.items.slice(1);

	if (remainingItems.length === 0) {
		targetLeaf.raw = displayBefore + firstItemText + displayAfter + targetLineEnding;
	} else {
		targetLeaf.raw = displayBefore + firstItemText + targetLineEnding;
		const lastItem = remainingItems[remainingItems.length - 1];
		const lastLeaf = lastItem.children![0];
		const lastLineEnding = lastLeaf.raw.endsWith('\r\n') ? '\r\n' : '\n';
		const lastDisplay = trimTrailingLineEnding(lastLeaf.raw);
		lastLeaf.raw = lastDisplay + displayAfter + lastLineEnding;
	}

	if (isProseKind(targetLeaf.kind)) {
		const range = getContentRange(targetLeaf);
		targetLeaf.inlineContent = parseInline(targetLeaf.raw, range.start, range.end);
	}
	if (remainingItems.length > 0) {
		const lastLeaf = remainingItems[remainingItems.length - 1].children![0];
		if (isProseKind(lastLeaf.kind)) {
			const range = getContentRange(lastLeaf);
			lastLeaf.inlineContent = parseInline(lastLeaf.raw, range.start, range.end);
		}
	}

	// Rebuild up from the mutated target leaf so its enclosing listItem
	// reflects the merged content before we splice siblings.
	rebuildAncestryForLeaf(ctx.doc, merge.targetLeafPath);

	if (remainingItems.length === 0) {
		// Force a reactivity publish so the bind updates with the new target-leaf content.
		// TODO: migrate via multi-scope commit primitive
		outerState.commitChildrenEdit(() => {});
		await tick();
		outerState.innerBlockRefs[unwrap.spliceIndex]?.focus(CURSOR_END);
		return;
	}

	// The last remaining item's enclosing listItem raw still reflects the
	// pre-mutation paragraph. Rebuild before splicing so the published
	// children carry correct raws in one reactive flush.
	rebuildContainerRawIfContainer(remainingItems[remainingItems.length - 1]);

	// TODO: migrate via multi-scope commit primitive
	outerState.commitChildrenEdit((children, ids, refs) => {
		children.splice(unwrap.spliceIndex + 1, 0, ...remainingItems);
		ids.splice(unwrap.spliceIndex + 1, 0, ...remainingItems.map(() => generateBlockId()));
		refs.splice(unwrap.spliceIndex + 1, 0, ...new Array(remainingItems.length).fill(undefined));
	});

	const lastInsertedIdx = unwrap.spliceIndex + remainingItems.length;
	rebuildAncestryForLeaf(ctx.doc, [...unwrap.outerPath, lastInsertedIdx, 0]);
	await tick();

	outerState.innerBlockRefs[lastInsertedIdx]?.focus(CURSOR_END);
}
