/**
 * Cross-block keyboard extension and collapse. Pure helpers over
 * SelectionState.
 */

import type { SelectionState } from './selection-state.svelte';
import type { SelectionPoint } from './primitives';
import type { Document } from '../core/nodes';
import { isVerticallyTransparentNode } from '../core/inline/transparency';
import type { BlockComponent } from '../block-component';
import { CURSOR_END } from '../block-component';
import {
	readNativeCaretInBlock,
	applyCollapsedCaret,
	focusCollapsedCaret,
	applySingleBlockRange,
	clearNativeSelection,
	offsetFromViewportPoint
} from './native-bridge';
import type { BlockElLookup } from '../editor-keys';
import {
	nextPath,
	previousPath,
	firstPath,
	lastPath,
	firstLeafAtOrAfter,
	lastLeafAtOrBefore,
	findCellPathForElement
} from './path-lookup';
import { nodeAt } from '../tree-operations/node-ops';
import { comparePaths, isStrictAncestorOf } from './path-math';
import { cellEndpointDeepPath } from './table-endpoint-snap';
import { displayLength } from '../core/lines';

// ── Enter / Collapse / Scroll ──────────────────────────────────────────────

/**
 * Enter cross-block mode on a keyboard extension (Shift+Arrow leaving a
 * block). Captures the native caret as both anchor and focus; the caller
 * immediately extendFocus()es to the actual target.
 */
function enterCrossBlockFromKeyboard(
	selection: SelectionState,
	currentBlockEl: HTMLElement,
	currentBlockPath: number[]
): boolean {
	const anchorPoint = readNativeCaretInBlock(currentBlockEl, currentBlockPath);
	if (!anchorPoint) return false;
	selection.enterCrossBlock(anchorPoint, {
		path: anchorPoint.path.slice(),
		offset: anchorPoint.offset
	});
	// Collapse (not clear) so the focus block retains a caret — otherwise
	// Chromium fires paste on <body>. See parkCaretInFocusBlock.
	applyCollapsedCaret(currentBlockEl, anchorPoint);
	return true;
}

/**
 * Collapse to start/end, restore a native caret, exit cross-block mode.
 * `revealPath` mounts the collapse target when it's off-window before the
 * caret is placed. A cell-coordinate target's offset is a linear cell index,
 * not a char offset, so the caret lands at the cell's edge via the cell ref
 * (the table grid has no meaningful caret position at that offset).
 */
export async function collapseCrossBlock(
	selection: SelectionState,
	to: 'start' | 'end',
	doc: Document,
	getBlockElByPath: (path: number[]) => HTMLElement | null,
	revealPath: (path: number[]) => Promise<BlockComponent | null>
): Promise<void> {
	const target = to === 'start' ? selection.start : selection.end;
	if (!target) return;
	selection.collapse();
	clearNativeSelection();

	const deepPath = cellEndpointDeepPath(doc, target);
	if (deepPath) {
		const cellRef = await revealPath(deepPath);
		cellRef?.focus(to === 'end' ? CURSOR_END : 0);
		return;
	}

	await revealPath(target.path);
	focusCollapsedCaret(getBlockElByPath, target);
}

/**
 * Scroll the focus block into view when it is mounted. This helper does not itself
 * reveal a windowed-out block: the doc-edge extend reveals (and pins the dispatch
 * caret in) an off-window endpoint via `revealActiveEndpoint` before calling this,
 * and a single-step Shift+Arrow extend lands on a block adjacent to the mounted
 * window, so it is already mounted. Editor-root keystroke routing is independent:
 * focus parks on the `.editor` root on unmount and a document-level listener routes
 * the next cross-block / undo-redo keystroke regardless.
 */
export function scrollFocusBlockIntoView(
	selection: SelectionState,
	getBlockElByPath: (path: number[]) => HTMLElement | null
): void {
	if (!selection.focus) return;
	const blockEl = getBlockElByPath(selection.focus.path);
	blockEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// ── Keyboard Extension ─────────────────────────────────────────────────────

/**
 * Move the cross-block focus to `target`, or — when the seam collapses because
 * the focus contracted back onto the anchor's prose leaf — restore the resulting
 * single-block range natively. Keyboard entry parks only a collapsed caret (no
 * native range tracks underneath, unlike a pointer drag), so the range must be
 * re-established here to stay visible and copyable. No-op restore without a
 * lookup (harness callers) or when the anchor block is off-window.
 */
function extendFocusOrRestore(
	selection: SelectionState,
	target: number[],
	offset: number,
	getBlockElByPath?: BlockElLookup
): void {
	const anchor = selection.anchor;
	selection.extendFocus({ path: target, offset });
	if (!anchor || selection.isCrossBlock || !getBlockElByPath) return;
	const blockEl = getBlockElByPath(target);
	if (!blockEl) return;
	blockEl.focus();
	applySingleBlockRange(blockEl, Math.min(anchor.offset, offset), Math.max(anchor.offset, offset));
}

/**
 * Extend focus to the next leaf in document order (Shift+ArrowDown /
 * Shift+ArrowRight leaving the current block). Enters cross-block mode if
 * still single-block. Returns true if focus moved.
 *
 * `axis` = 'vertical' (Shift+ArrowDown) skips vertically-transparent leaves —
 * mirrors single-block focus dispatch. 'horizontal' (Shift+ArrowRight) lands on
 * the next leaf unconditionally so the user can select an image-only paragraph
 * in one step.
 */
export function extendFocusToNextBlock(
	selection: SelectionState,
	doc: Document,
	currentBlockEl: HTMLElement,
	currentBlockPath: number[],
	axis: 'horizontal' | 'vertical' = 'horizontal',
	getBlockElByPath?: BlockElLookup
): boolean {
	const leafTarget =
		axis === 'vertical'
			? firstNonTransparentLeafAfter(doc, currentBlockPath)
			: firstLeafAfter(doc, currentBlockPath);
	if (!leafTarget) return false;

	if (!selection.isCrossBlock) {
		if (!enterCrossBlockFromKeyboard(selection, currentBlockEl, currentBlockPath)) return false;
	}
	extendFocusOrRestore(selection, leafTarget, 0, getBlockElByPath);
	return true;
}

/**
 * Extend focus to the previous leaf (Shift+ArrowUp / Shift+ArrowLeft).
 * `side` = 'end' for ArrowLeft (horizontal — cross boundary by one char),
 * 'start' for ArrowUp (vertical — select the whole previous line, matching
 * native behavior). The vertical path also skips vertically-transparent
 * leaves so parity with single-block dispatch holds.
 */
export function extendFocusToPreviousBlock(
	selection: SelectionState,
	doc: Document,
	currentBlockEl: HTMLElement,
	currentBlockPath: number[],
	side: 'start' | 'end' = 'end',
	getBlockElByPath?: BlockElLookup
): boolean {
	const leafTarget =
		side === 'start'
			? lastNonTransparentLeafBefore(doc, currentBlockPath)
			: lastLeafBefore(doc, currentBlockPath);
	if (!leafTarget) return false;

	if (!selection.isCrossBlock) {
		if (!enterCrossBlockFromKeyboard(selection, currentBlockEl, currentBlockPath)) return false;
	}
	const offset = side === 'start' ? 0 : leafOffsetEnd(doc, leafTarget);
	extendFocusOrRestore(selection, leafTarget, offset, getBlockElByPath);
	return true;
}

/**
 * Extend focus to the document edge (Ctrl+Shift+Home / Ctrl+Shift+End).
 * Vertical-skip applies: a transparent edge leaf is bypassed in favor of
 * the nearest text-bearing leaf, matching the cross-block extension path.
 */
export function extendFocusToDocEdge(
	selection: SelectionState,
	doc: Document,
	currentBlockEl: HTMLElement,
	currentBlockPath: number[],
	to: 'start' | 'end',
	getBlockElByPath?: BlockElLookup
): boolean {
	const edge = to === 'start' ? firstPath(doc) : lastPath(doc);
	if (!edge) return false;

	const target = isTransparent(doc, edge)
		? to === 'start'
			? firstNonTransparentLeafFrom(doc, edge)
			: lastNonTransparentLeafFrom(doc, edge)
		: edge;
	if (!target) return false;

	if (!selection.isCrossBlock) {
		if (!enterCrossBlockFromKeyboard(selection, currentBlockEl, currentBlockPath)) return false;
	}

	const offset = to === 'end' ? leafOffsetEnd(doc, target) : 0;
	extendFocusOrRestore(selection, target, offset, getBlockElByPath);
	return true;
}

/**
 * Select the entire document as a cross-block range (second Ctrl+A press).
 */
export function selectWholeDocument(
	selection: SelectionState,
	doc: Document,
	getBlockElByPath?: (path: number[]) => HTMLElement | null
): boolean {
	const first = firstPath(doc);
	const last = lastPath(doc);
	if (!first || !last) return false;
	const lastOffset = leafOffsetEnd(doc, last);
	selection.enterCrossBlock({ path: first, offset: 0 }, { path: last, offset: lastOffset });

	// A single prose leaf (whole doc is one block) has no cross-block state to
	// paint — the seam refuses it. Select it natively rather than clearing the
	// selection (2nd Ctrl+A on a one-block doc must not deselect).
	if (!selection.isCustomRendered) {
		selection.collapse();
		const blockEl = getBlockElByPath?.(first);
		if (blockEl) {
			blockEl.focus();
			applySingleBlockRange(blockEl, 0, lastOffset);
		}
		return true;
	}

	// Paste-dispatch anchor, see enterCrossBlockFromKeyboard. A table focus
	// endpoint normalizes to the table block, whose wrapper holds no caret —
	// park in its deep cell instead, as collapseCrossBlock does.
	const focus = selection.focus;
	const deepPath = focus && cellEndpointDeepPath(doc, focus);
	const parkPoint = deepPath ? { path: deepPath, offset: 0 } : focus;
	const focusBlockEl = parkPoint ? getBlockElByPath?.(parkPoint.path) : null;
	if (focusBlockEl && parkPoint) applyCollapsedCaret(focusBlockEl, parkPoint);
	else clearNativeSelection();
	return true;
}

// ── Shift+Click ────────────────────────────────────────────────────────────

/**
 * Shift+click on a block. Extends the current cross-block selection or
 * enters cross-block mode using the previously focused block's caret as
 * the anchor. Returns false when no anchor could be recovered or the click
 * stayed within the same block (native shift-click handles that).
 */
export function handleShiftClick(
	selection: SelectionState,
	clickedBlockEl: HTMLElement,
	clickedBlockPath: number[],
	clickedX: number,
	clickedY: number,
	previouslyFocusedBlockEl: HTMLElement | null,
	previouslyFocusedBlockPath: number[] | null
): boolean {
	const clickOffset = offsetFromViewportPoint(clickedBlockEl, clickedX, clickedY);
	if (clickOffset === null) return false;
	const focusPoint: SelectionPoint = { path: clickedBlockPath.slice(), offset: clickOffset };

	if (selection.isCrossBlock) {
		selection.extendFocus(focusPoint);
		return true;
	}

	if (!previouslyFocusedBlockEl || !previouslyFocusedBlockPath) return false;
	// The anchor path is resolved from the DOM, not from a surface's getMyPath(),
	// and no path host exists below a table — so a caret parked in a cell would be
	// labelled with the TABLE's path while its offset is still in characters. The
	// endpoint seam cannot repair that (a char offset on a table path is
	// indistinguishable from a cell index), so deepen to the cell here and let the
	// seam do the char→cell conversion it does for every other producer.
	const anchorPath = findCellPathForElement(previouslyFocusedBlockEl) ?? previouslyFocusedBlockPath;
	const anchor = readNativeCaretInBlock(previouslyFocusedBlockEl, anchorPath);
	if (!anchor) return false;

	// Same-block — native selection already produced a single-block range.
	if (comparePaths(anchor.path, focusPoint.path) === 0) return false;

	selection.enterCrossBlock(anchor, focusPoint);
	// Paste-dispatch anchor, see enterCrossBlockFromKeyboard. The click
	// default already plants one; being explicit avoids relying on that.
	applyCollapsedCaret(clickedBlockEl, focusPoint);
	return true;
}

// ── Internal ───────────────────────────────────────────────────────────────

/** First leaf reachable from `fromPath` going forward (descend or step). */
function firstLeafAfter(doc: Document, fromPath: number[]): number[] | null {
	const next = nextPath(doc, fromPath);
	return next ? firstLeafAtOrAfter(doc, next) : null;
}

/** Last leaf reachable from `fromPath` going backward (descend or step). */
function lastLeafBefore(doc: Document, fromPath: number[]): number[] | null {
	// previousPath is doc-order (ancestor-before-descendant), so a first-child
	// leaf's "previous" is its own container — descending into that ancestor's
	// LAST leaf would move the walk forward (and lets the transparent-skip
	// callers ping-pong between two leaves). Skip ancestors until a genuinely
	// preceding subtree (or the document start) is reached.
	let prev = previousPath(doc, fromPath);
	while (prev && isStrictAncestorOf(prev, fromPath)) prev = previousPath(doc, prev);
	return prev ? lastLeafAtOrBefore(doc, prev) : null;
}

function isTransparent(doc: Document, path: number[]): boolean {
	const node = nodeAt(doc, path);
	// nodeAt returns the Document for an empty path; leaf paths here are never
	// empty, but narrow it out (Document has no `raw`) so the predicate only ever
	// sees a block node.
	return node !== null && 'raw' in node && isVerticallyTransparentNode(node);
}

function firstNonTransparentLeafAfter(doc: Document, fromPath: number[]): number[] | null {
	let leaf = firstLeafAfter(doc, fromPath);
	while (leaf && isTransparent(doc, leaf)) {
		leaf = firstLeafAfter(doc, leaf);
	}
	return leaf;
}

function lastNonTransparentLeafBefore(doc: Document, fromPath: number[]): number[] | null {
	let leaf = lastLeafBefore(doc, fromPath);
	while (leaf && isTransparent(doc, leaf)) {
		leaf = lastLeafBefore(doc, leaf);
	}
	return leaf;
}

/**
 * Doc-edge resolver: starting AT the edge leaf (which is itself transparent),
 * step inward until a text-bearing leaf is found. Distinct from the
 * "first/lastLeafAfter/Before" walkers because those step away from `fromPath`.
 */
function firstNonTransparentLeafFrom(doc: Document, startPath: number[]): number[] | null {
	if (!isTransparent(doc, startPath)) return startPath;
	return firstNonTransparentLeafAfter(doc, startPath);
}

function lastNonTransparentLeafFrom(doc: Document, startPath: number[]): number[] | null {
	if (!isTransparent(doc, startPath)) return startPath;
	return lastNonTransparentLeafBefore(doc, startPath);
}

function leafOffsetEnd(doc: Document, path: number[]): number {
	const node = nodeAt(doc, path);
	if (!node || !('raw' in node) || typeof node.raw !== 'string') return 0;
	// raw includes a trailing newline; the cursor works in display space.
	return displayLength(node.raw);
}
