/**
 * Bridge between the browser's native Selection API and SelectionPoint.
 * Pure: callers provide target block elements and paths; no tree walking.
 */

import type { SelectionPoint, EditorSelection } from './primitives';
import type { SelectionState } from './selection-state.svelte';
import { comparePaths } from './primitives';
import { createRangeFromOffsets, getCursorOffset } from '../contenteditable/cursor-utils';

// ── Read native → SelectionPoint ────────────────────────────────────────────

/**
 * Read the collapsed caret inside `blockEl` into a SelectionPoint. Returns
 * null when the caret isn't inside this element.
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

export function applyCollapsedCaret(blockEl: HTMLElement, point: SelectionPoint): void {
	const range = createRangeFromOffsets(blockEl, point.offset, point.offset);
	if (!range) return;
	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(range);
}

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

export function clearNativeSelection(): void {
	window.getSelection()?.removeAllRanges();
}

// ── Selection read/restore for undo ─────────────────────────────────────────

/**
 * Effective editor selection: cross-block from SelectionState if active,
 * otherwise collapsed from the native caret. Null when the editor is
 * unfocused (no block reports a cursor).
 */
export function readCurrentSelection(
	selectionState: SelectionState,
	blockRefs: ({ getCursorOffset(): number | null } | undefined)[],
	buildCollapsed: (blockIndex: number, offset: number) => EditorSelection
): EditorSelection | null {
	if (selectionState.isCrossBlock && selectionState.anchor && selectionState.focus) {
		return {
			anchor: { path: selectionState.anchor.path.slice(), offset: selectionState.anchor.offset },
			focus: { path: selectionState.focus.path.slice(), offset: selectionState.focus.offset }
		};
	}
	const focusedIndex = blockRefs.findIndex((b) => b !== undefined && b.getCursorOffset() !== null);
	if (focusedIndex === -1) return null;
	const focusedOffset = blockRefs[focusedIndex]!.getCursorOffset()!;
	return buildCollapsed(focusedIndex, focusedOffset);
}

/**
 * Apply a restored EditorSelection to the DOM / SelectionState:
 * collapsed → native caret, single-block range → native range,
 * cross-block → SelectionState cross-block mode.
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

	// Park a collapsed caret in the focus block as a paste-dispatch anchor;
	// without it, Chromium routes paste events to <body>.
	selectionState.enterCrossBlock(selection.anchor, selection.focus);
	const focusBlockEl = getBlockElByPath(selection.focus.path);
	if (focusBlockEl) {
		applyCollapsedCaret(focusBlockEl, selection.focus);
		focusBlockEl.focus();
	} else {
		clearNativeSelection();
	}
}

// ── Viewport point → block offset ───────────────────────────────────────────

/**
 * Convert a viewport coordinate to a character offset inside a block.
 * Returns null when the point is outside `blockEl`.
 */
export function offsetFromViewportPoint(
	blockEl: HTMLElement,
	clientX: number,
	clientY: number
): number | null {
	const doc = blockEl.ownerDocument;
	// caretRangeFromPoint is Chromium/WebKit (all Tauri webviews);
	// caretPositionFromPoint is the Firefox-style fallback.
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
