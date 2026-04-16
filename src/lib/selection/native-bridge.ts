/**
 * Bridge between the browser's native Selection API and our SelectionPoint
 * type. Responsibilities:
 *   1. Read a native caret/range inside a block element and map to SelectionPoint.
 *   2. Apply a SelectionPoint or single-block range to the native selection.
 *   3. Clear the native selection entirely.
 *   4. Map a viewport coordinate to a character offset inside a block.
 *   5. Read the effective selection (cross-block or native) for undo snapshots.
 *   6. Classify and restore an EditorSelection to DOM / SelectionState.
 *
 * This module has no tree-walking logic — callers provide the target block
 * element and its path.
 */

import type { SelectionPoint, EditorSelection } from './selection-types';
import type { SelectionState } from './selection-state.svelte';
import { comparePaths } from './selection-point';
import { createRangeFromOffsets, getCursorOffset } from '../text-surface/cursor-utils';

// ── Read native → SelectionPoint ────────────────────────────────────────────

/**
 * Read the collapsed native caret inside `blockEl` and return a
 * SelectionPoint carrying the block's path. Returns null if the caret is
 * not inside this element.
 */
export function readNativeCaretInBlock(
	blockEl: HTMLElement,
	path: number[]
): SelectionPoint | null {
	const offset = getCursorOffset(blockEl);
	if (offset === null) return null;
	return { path: path.slice(), offset };
}

// ── Apply SelectionPoint → native ───────────────────────────────────────────

/** Place a collapsed native caret inside `blockEl` at `point.offset`. */
export function applyCollapsedCaret(blockEl: HTMLElement, point: SelectionPoint): void {
	const range = createRangeFromOffsets(blockEl, point.offset, point.offset);
	if (!range) return;
	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(range);
}

/** Apply a single-block range selection inside `blockEl`. */
export function applySingleBlockRange(
	blockEl: HTMLElement,
	startOffset: number,
	endOffset: number
): void {
	const range = createRangeFromOffsets(blockEl, startOffset, endOffset);
	if (!range) return;
	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(range);
}

/** Clear the browser's native selection entirely. */
export function clearNativeSelection(): void {
	window.getSelection()?.removeAllRanges();
}

// ── Selection read/restore for undo ─────────────────────────────────────────

/**
 * Read the effective editor selection: cross-block from SelectionState if
 * active, otherwise collapsed from the native caret. Returns a collapsed
 * zero selection as fallback.
 */
export function readCurrentSelection(
	selectionState: SelectionState,
	blockRefs: { getCursorOffset(): number | null }[],
	buildCollapsed: (blockIndex: number, offset: number) => EditorSelection
): EditorSelection {
	if (selectionState.isCrossBlock && selectionState.anchor && selectionState.focus) {
		return {
			anchor: { path: selectionState.anchor.path.slice(), offset: selectionState.anchor.offset },
			focus: { path: selectionState.focus.path.slice(), offset: selectionState.focus.offset }
		};
	}
	const focusedIndex = Math.max(
		0,
		blockRefs.findIndex((b) => b?.getCursorOffset() !== null)
	);
	const focusedOffset = blockRefs[focusedIndex]?.getCursorOffset() ?? 0;
	return buildCollapsed(focusedIndex, focusedOffset);
}

/**
 * Classify a restored EditorSelection and apply it to the DOM:
 * - Collapsed (same path and offset): place a native caret
 * - Single-block range (same path, different offsets): native range selection
 * - Cross-block (different paths): enter SelectionState cross-block mode
 */
export function applySelectionToDom(
	selection: EditorSelection,
	selectionState: SelectionState,
	getBlockElByPath: (path: number[]) => HTMLElement | null
): void {
	const samePath = comparePaths(selection.anchor.path, selection.focus.path) === 0;
	const sameOffset = selection.anchor.offset === selection.focus.offset;

	if (samePath && sameOffset) {
		selectionState.clear();
		const blockEl = getBlockElByPath(selection.anchor.path);
		if (blockEl) {
			applyCollapsedCaret(blockEl, selection.anchor);
			blockEl.focus();
		}
		return;
	}

	if (samePath) {
		selectionState.clear();
		const blockEl = getBlockElByPath(selection.anchor.path);
		if (blockEl) {
			applySingleBlockRange(blockEl, selection.anchor.offset, selection.focus.offset);
			blockEl.focus();
		}
		return;
	}

	// Cross-block: populate SelectionState and clear native selection
	selectionState.enterCrossBlock(selection.anchor, selection.focus);
	clearNativeSelection();
	const focusBlockEl = getBlockElByPath(selection.focus.path);
	focusBlockEl?.focus();
}

// ── Viewport point → block offset ───────────────────────────────────────────

/**
 * Convert a viewport coordinate to a character offset inside a block.
 * Used by pointer drag for hit-testing and by shift-click for anchor
 * recovery. Returns null if the point is not inside `blockEl`.
 */
export function offsetFromViewportPoint(
	blockEl: HTMLElement,
	clientX: number,
	clientY: number
): number | null {
	const doc = blockEl.ownerDocument;
	// caretRangeFromPoint is the Chromium/WebKit API (all Tauri webviews).
	// Fall back to caretPositionFromPoint for defensive compat (Firefox-style).
	const rangeFromPoint = (
		doc as Document & {
			caretRangeFromPoint?: (x: number, y: number) => Range | null;
		}
	).caretRangeFromPoint?.(clientX, clientY);
	if (rangeFromPoint && blockEl.contains(rangeFromPoint.startContainer)) {
		return domToCharOffset(blockEl, rangeFromPoint.startContainer, rangeFromPoint.startOffset);
	}
	const posFromPoint = (
		doc as Document & {
			caretPositionFromPoint?: (
				x: number,
				y: number
			) => { offsetNode: Node; offset: number } | null;
		}
	).caretPositionFromPoint?.(clientX, clientY);
	if (posFromPoint && blockEl.contains(posFromPoint.offsetNode)) {
		return domToCharOffset(blockEl, posFromPoint.offsetNode, posFromPoint.offset);
	}
	return null;
}

// ── Internal ────────────────────────────────────────────────────────────────

function domToCharOffset(root: HTMLElement, node: Node, nodeOffset: number): number | null {
	if (!root.contains(node)) return null;
	const range = document.createRange();
	range.setStart(root, 0);
	range.setEnd(node, nodeOffset);
	return range.toString().length;
}
