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
 */

import { tick } from 'svelte';
import type { BlockKind, CstNode, Document } from '../core/nodes';
import type { BlockEditActions, BlockComponent } from '../contracts';
import { CURSOR_END } from '../contracts';
import { parse } from '../core/parser';
import { trimTrailingLineEnding } from '../core/lines';
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
	blockEdit: BlockEditActions;
	/** Top-level block refs, for focus landing on top-level pastes. */
	blockRefs: (BlockComponent | undefined)[];
	/** Skip pushing an undo snapshot — caller already owns the bracket. */
	skipSnapshot?: boolean;
}

/**
 * Execute a paste at the specified target position. Parses the clipboard,
 * picks inline vs structural based on the parsed shape, looks up the
 * target's PasteSurface, and routes the resulting mutation.
 */
export async function pasteDispatch(
	input: PasteDispatchInput,
	ctx: PasteDispatchContext
): Promise<void> {
	if (!input.pastedText) return;

	const parsed = parse(input.pastedText);
	if (parsed.children.length === 0) return;

	const targetNode = nodeAt(ctx.doc, input.targetPath) as CstNode | null;
	if (!targetNode) return;

	const strategy = pickPasteStrategy(parsed);
	const surface = getPasteSurface(targetNode.kind);

	if (strategy === 'inline') {
		const hook = surface?.onInlinePaste ?? defaultInlineHook;
		const result = hook(targetNode, input.offset, input.pastedText, input.preDelete);
		await applyInlineResult(input.targetPath, result, ctx);
		return;
	}

	const hook = surface?.onStructuralPaste ?? defaultStructuralHook;
	const result = hook(targetNode, input.offset, parsed.children, input.preDelete);
	await applyStructuralResult(input.targetPath, result, ctx);
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
		effectiveDisplay.slice(0, effectiveOffset) +
		text +
		effectiveDisplay.slice(effectiveOffset);

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

// Prose text kinds share paste semantics — register a default surface for
// each at module load. Code registers its own in code-bootstrap; future
// table / plugin surfaces register at their own bootstrap time.
for (const kind of ['paragraph', 'heading', 'setextHeading'] as const) {
	registerPasteSurface({
		kind,
		onInlinePaste: defaultInlineHook,
		onStructuralPaste: defaultStructuralHook
	});
}

/** Test-only: produce a default text surface descriptor (for unit tests). */
export function __getDefaultTextSurface(kind: BlockKind): PasteSurface {
	return {
		kind,
		onInlinePaste: defaultInlineHook,
		onStructuralPaste: defaultStructuralHook
	};
}

// ── Mutation routing ───────────────────────────────────────────────────────

async function applyInlineResult(
	targetPath: number[],
	result: InlinePasteResult,
	ctx: PasteDispatchContext
): Promise<void> {
	if (targetPath.length === 1) {
		// Top-level inline paste routes through updateBlockContent which already
		// handles undo debouncing, kind-change re-render, and focus.
		await ctx.blockEdit.updateBlockContent(targetPath[0], result.newRaw, result.caretOffset);
		await tick();
		ctx.blockRefs[targetPath[0]]?.focus(result.caretOffset);
		return;
	}

	// Nested inline paste: mutate raw directly, rebuild ancestry raw. Mirrors
	// the pattern cross-block-dispatch's inline path used pre-consolidation
	// for nested targets.
	const targetNode = nodeAt(ctx.doc, targetPath) as CstNode | null;
	if (!targetNode) return;
	targetNode.raw = result.newRaw;
	rebuildAncestryForLeaf(ctx.doc, targetPath);
	await tick();
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
	// BlockListState so ids/refs stay aligned (same as the 0.5.1-rewritten
	// nested paste path).
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
