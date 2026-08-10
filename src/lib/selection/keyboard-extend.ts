/** Cross-block keyboard extension and collapse. Pure helpers over SelectionState. */

import type { SelectionState } from './selection-state.svelte';
import type { SelectionPoint } from './primitives';
import type { Document } from '../core/nodes';
import { isVerticallyTransparentNode } from '../core/inline/transparency';
import type { BlockComponent } from '../block-component';
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
 * Enter cross-block mode on a keyboard extension (Shift+Arrow leaving a block). Captures the
 * native caret as both anchor and focus; the caller immediately extendFocus()es to the target.
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
	// Collapse (not clear) so the focus block retains a caret, or Chromium retargets clipboard
	// events to <body> (same rule as `parkCaretInFocusBlock`). Best-effort: an endpoint hosting
	// no text position gets no caret, which is why components/editor-root-clipboard.ts exists.
	applyCollapsedCaret(currentBlockEl, anchorPoint);
	return true;
}

/**
 * Collapse to start/end, restore a native caret, exit cross-block mode. `revealPath` mounts an
 * off-window target first. A cell-coordinate target's offset is a cell index, not a char
 * offset, so the caret lands at the cell's edge via the cell ref.
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

	// A cell endpoint's offset is a cell INDEX, so its caret point is the cell's own edge; from
	// there it takes the SAME seat as a prose leaf. Seating through the cell's own focus door
	// instead would skip the collapse ceremony, and the byte typed at the arrival would join the
	// construct the cell opens with rather than land in front of it.
	const deepPath = cellEndpointDeepPath(doc, target);
	const path = deepPath ?? target.path;
	const point: SelectionPoint = deepPath
		? { path: deepPath, offset: to === 'end' ? leafOffsetEnd(doc, deepPath) : 0 }
		: target;

	// The landable clamp (a caret may not sit past a hidden run) lives in applyCollapsedCaret.
	await revealPath(path);
	focusCollapsedCaret(getBlockElByPath, point);
}

/**
 * Scroll the focus block into view when mounted. Does not itself reveal a windowed-out block:
 * the doc-edge extend reveals its endpoint via `revealActiveEndpoint` first, and a single-step
 * Shift+Arrow extend lands adjacent to the mounted window.
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
 * Move the cross-block focus to `target`, or restore the resulting single-block range natively
 * when the seam collapses (focus contracted back onto the anchor's prose leaf). Keyboard entry
 * parks only a collapsed caret, so the range must be re-established here to stay visible.
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
 * Extend focus to the next leaf in document order (Shift+ArrowDown / Shift+ArrowRight leaving
 * the block), entering cross-block mode if needed. Returns true if focus moved. `axis` =
 * 'vertical' skips vertically-transparent leaves, mirroring single-block focus dispatch;
 * 'horizontal' lands unconditionally so an image-only paragraph is selectable in one step.
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
 * Extend focus to the previous leaf (Shift+ArrowUp / Shift+ArrowLeft). `side` = 'end' for
 * ArrowLeft (cross the boundary by one char), 'start' for ArrowUp (select the whole previous
 * line, matching native). The vertical path skips vertically-transparent leaves.
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
 * Extend focus to the document edge (Mod+Shift+Home / Mod+Shift+End). A transparent edge
 * leaf is bypassed for the nearest text-bearing one, matching the cross-block extension path.
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

/** Select the entire document as a cross-block range (second Ctrl+A press). */
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

	// A single prose leaf (whole doc is one block) has no cross-block state to paint; the seam
	// refuses it. Select natively so a 2nd Ctrl+A on a one-block doc doesn't deselect.
	if (!selection.isCustomRendered) {
		selection.collapse();
		const blockEl = getBlockElByPath?.(first);
		if (blockEl) {
			blockEl.focus();
			applySingleBlockRange(blockEl, 0, lastOffset);
		}
		return true;
	}

	// Paste-dispatch anchor, see enterCrossBlockFromKeyboard. A table focus normalizes to the
	// table block, whose wrapper holds no caret, so park in its deep cell.
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
 * Shift+click on a block: extend the cross-block selection, or enter cross-block mode using the
 * previously focused block's caret as the anchor. False when no anchor could be recovered, or
 * the click stayed within the same block (native shift-click handles that).
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
	// The anchor path comes from the DOM, and no path host exists below a table, so a caret
	// parked in a cell would carry the TABLE's path with a char offset. The endpoint seam can't
	// tell that from a cell index, so deepen to the cell here and let the seam convert.
	const anchorPath = findCellPathForElement(previouslyFocusedBlockEl) ?? previouslyFocusedBlockPath;
	const anchor = readNativeCaretInBlock(previouslyFocusedBlockEl, anchorPath);
	if (!anchor) return false;

	// Same-block — native selection already produced a single-block range.
	if (comparePaths(anchor.path, focusPoint.path) === 0) return false;

	selection.enterCrossBlock(anchor, focusPoint);
	// Paste-dispatch anchor (see enterCrossBlockFromKeyboard); the click default isn't relied on.
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
	// previousPath is doc-order (ancestor-before-descendant), so a first-child leaf's "previous"
	// is its own container, and descending into that ancestor's LAST leaf would move the walk
	// forward. Skip ancestors until a genuinely preceding subtree is reached.
	let prev = previousPath(doc, fromPath);
	while (prev && isStrictAncestorOf(prev, fromPath)) prev = previousPath(doc, prev);
	return prev ? lastLeafAtOrBefore(doc, prev) : null;
}

function isTransparent(doc: Document, path: number[]): boolean {
	const node = nodeAt(doc, path);
	// nodeAt returns the Document for an empty path; narrow it out (Document has no `raw`).
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
 * Doc-edge resolver: start AT the edge leaf and step inward to a text-bearing leaf. Distinct
 * from the leafAfter/leafBefore walkers, which step away from `fromPath`.
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
