/**
 * Cross-block keyboard extension and collapse. Pure helpers that enter,
 * extend, or collapse cross-block mode in response to keyboard and
 * pointer events. No state of their own — SelectionState holds the
 * anchor/focus and every function reads or writes through it.
 */

import type { SelectionState } from './selection-state.svelte';
import type { SelectionPoint } from './selection-types';
import type { Document } from '../core/nodes';
import {
	readNativeCaretInBlock,
	applyCollapsedCaret,
	clearNativeSelection,
	offsetFromViewportPoint
} from './native-bridge';
import { nextPath, previousPath, firstPath, lastPath, nodeAt } from './path-lookup';
import { comparePaths } from './selection-point';
import { displayLength } from '../raw-text';

// ── Enter / Collapse / Scroll ──────────────────────────────────────────────

/**
 * Transition from single-block to cross-block mode on a keyboard extension
 * (Shift+Arrow leaving a block). Reads the native caret from
 * `currentBlockEl`, populates SelectionState with that caret as both anchor
 * and focus, then clears the native selection.
 *
 * The caller decides WHERE the focus should land — this function only
 * captures the anchor and enters cross-block mode with `focus === anchor`
 * initially. The caller immediately calls `selection.extendFocus(target)`
 * after this returns true.
 */
export function enterCrossBlockFromKeyboard(
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
	clearNativeSelection();
	return true;
}

/**
 * Collapse the cross-block selection to its start or end and restore a
 * native caret at that point. Exits cross-block mode.
 */
export function collapseCrossBlock(
	selection: SelectionState,
	to: 'start' | 'end',
	getBlockElByPath: (path: number[]) => HTMLElement | null
): void {
	const target = to === 'start' ? selection.start : selection.end;
	if (!target) return;
	selection.collapse();
	clearNativeSelection();
	const blockEl = getBlockElByPath(target.path);
	if (blockEl) {
		applyCollapsedCaret(blockEl, target);
		blockEl.focus();
	}
}

/**
 * After extending the focus endpoint, scroll the focus block into view.
 * No-op if the focus block is already visible.
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
 * Extend cross-block focus to the next leaf block in document order. Called
 * on Shift+ArrowDown / Shift+ArrowRight leaving the current block. Enters
 * cross-block mode first if the selection is still single-block (anchor =
 * native caret).
 *
 * Returns true if focus moved, false if no next leaf exists or entering
 * cross-block mode failed.
 */
export function extendFocusToNextBlock(
	selection: SelectionState,
	doc: Document,
	currentBlockEl: HTMLElement,
	currentBlockPath: number[]
): boolean {
	const target = nextPath(doc, currentBlockPath);
	if (!target) return false;
	const leafTarget = firstLeafAtOrAfter(doc, target);
	if (!leafTarget) return false;

	if (!selection.isCrossBlock) {
		if (!enterCrossBlockFromKeyboard(selection, currentBlockEl, currentBlockPath)) return false;
	}
	selection.extendFocus({ path: leafTarget, offset: 0 });
	return true;
}

/**
 * Extend cross-block focus to the previous leaf block in document order.
 * Called on Shift+ArrowUp / Shift+ArrowLeft leaving the current block.
 *
 * `side` controls where the focus lands within the target leaf:
 *   - `'end'` (default): offset at the end of the leaf's display content.
 *     Correct for Shift+ArrowLeft, which crosses the boundary by one
 *     character.
 *   - `'start'`: offset 0. Correct for Shift+ArrowUp, which selects the
 *     entire previous line (matching native multi-line selection behavior).
 */
export function extendFocusToPreviousBlock(
	selection: SelectionState,
	doc: Document,
	currentBlockEl: HTMLElement,
	currentBlockPath: number[],
	side: 'start' | 'end' = 'end'
): boolean {
	const target = previousPath(doc, currentBlockPath);
	if (!target) return false;
	const leafTarget = lastLeafAtOrBefore(doc, target);
	if (!leafTarget) return false;

	if (!selection.isCrossBlock) {
		if (!enterCrossBlockFromKeyboard(selection, currentBlockEl, currentBlockPath)) return false;
	}
	const offset = side === 'start' ? 0 : leafOffsetEnd(doc, leafTarget);
	selection.extendFocus({ path: leafTarget, offset });
	return true;
}

/**
 * Extend cross-block focus to the document start or end. Called on
 * Ctrl+Shift+Home / Ctrl+Shift+End. Enters cross-block mode first if the
 * selection is still single-block.
 */
export function extendFocusToDocEdge(
	selection: SelectionState,
	doc: Document,
	currentBlockEl: HTMLElement,
	currentBlockPath: number[],
	to: 'start' | 'end'
): boolean {
	const edge = to === 'start' ? firstPath(doc) : lastPath(doc);
	if (!edge) return false;

	if (!selection.isCrossBlock) {
		if (!enterCrossBlockFromKeyboard(selection, currentBlockEl, currentBlockPath)) return false;
	}

	const offset = to === 'end' ? leafOffsetEnd(doc, edge) : 0;
	selection.extendFocus({ path: edge, offset });
	return true;
}

/**
 * Select the entire document as a cross-block range. Used by the second
 * press of Ctrl+A. Anchors at the first leaf's start and focuses at the
 * last leaf's end.
 */
export function selectWholeDocument(selection: SelectionState, doc: Document): boolean {
	const first = firstPath(doc);
	const last = lastPath(doc);
	if (!first || !last) return false;
	selection.enterCrossBlock(
		{ path: first, offset: 0 },
		{ path: last, offset: leafOffsetEnd(doc, last) }
	);
	clearNativeSelection();
	return true;
}

// ── Shift+Click ────────────────────────────────────────────────────────────

/**
 * Handle a Shift+click on a block at a given viewport coordinate. Extends
 * the current cross-block selection or enters cross-block mode using the
 * previously focused block's caret as the anchor.
 *
 * Returns true if the selection was updated, false if no anchor could be
 * recovered or the click stayed within the same block (native shift-click
 * handles single-block selection).
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
	const anchor = readNativeCaretInBlock(previouslyFocusedBlockEl, previouslyFocusedBlockPath);
	if (!anchor) return false;

	// Same-block shift-click — native selection already produced a single-block
	// range, so leave cross-block mode inactive.
	if (comparePaths(anchor.path, focusPoint.path) === 0) return false;

	selection.enterCrossBlock(anchor, focusPoint);
	clearNativeSelection();
	return true;
}

// ── Internal ───────────────────────────────────────────────────────────────

/** Walk forward from `path` to the first leaf (non-container) block. */
function firstLeafAtOrAfter(doc: Document, path: number[]): number[] | null {
	let cur: number[] | null = path;
	while (cur) {
		const node = nodeAt(doc, cur);
		if (!node) return null;
		if (!('children' in node) || !node.children || node.children.length === 0) return cur;
		cur = [...cur, 0];
	}
	return null;
}

/** Walk backward from `path` into the deepest last descendant leaf. */
function lastLeafAtOrBefore(doc: Document, path: number[]): number[] | null {
	let cur: number[] | null = path;
	while (cur) {
		const node = nodeAt(doc, cur);
		if (!node) return null;
		if (!('children' in node) || !node.children || node.children.length === 0) return cur;
		cur = [...cur, node.children.length - 1];
	}
	return null;
}

/** Character offset at the end of the leaf node at `path`. 0 if missing. */
function leafOffsetEnd(doc: Document, path: number[]): number {
	const node = nodeAt(doc, path);
	if (!node || !('raw' in node) || typeof node.raw !== 'string') return 0;
	// raw includes a trailing newline (CST invariant); the cursor system
	// works in display space, so use displayLength to strip it.
	return displayLength(node.raw);
}
