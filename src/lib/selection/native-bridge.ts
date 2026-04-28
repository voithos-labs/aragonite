/**
 * Bridge between the browser's native Selection API and SelectionPoint.
 * Pure: callers provide target block elements and paths; no tree walking.
 *
 * SelectionPoint offsets are raw-semantic (they index into the block's raw
 * content). When a block's first child is an ambient marker span
 * (contenteditable="false"), its textContent contributes to DOM offsets but
 * not to raw; DOM→raw conversion subtracts that ambient length.
 */

import type { SelectionPoint, EditorSelection } from './primitives';
import type { SelectionState } from './selection-state.svelte';
import type { BlockComponent } from '../block-component';
import { comparePaths } from './primitives';
import { createRangeFromOffsets, getCursorOffset } from '../cursor/cursor-utils';
import { domToRawOffset, rawToDomOffset } from '../ambient/ambient-offset';
import { ambientLengthOf, placeCaretAfterAmbientSpan } from '../ambient/ambient-dom';

// ── Read native → SelectionPoint ────────────────────────────────────────────

/**
 * Read the collapsed caret inside `blockEl` into a raw-semantic SelectionPoint.
 * Returns null when the caret isn't inside this element.
 */
export function readNativeCaretInBlock(
	blockEl: HTMLElement,
	path: number[]
): SelectionPoint | null {
	const domOffset = getCursorOffset(blockEl);
	if (domOffset === null) return null;
	return { path: path.slice(), offset: domToRawOffset(domOffset, ambientLengthOf(blockEl)) };
}

// ── Apply SelectionPoint → native ───────────────────────────────────────────

/**
 * Place a collapsed native caret at a raw-semantic SelectionPoint. Translates
 * through the block's ambient length (0 when no marker island is present).
 * Raw offset 0 under an ambient marker is placed at the sibling boundary AFTER
 * the marker span — createRangeFromOffsets would otherwise walk into the
 * contenteditable="false" text node, and Chromium bounces the caret out of
 * scope. Mirrors TextEditableBlock.setCursorToAmbientBoundary.
 */
export function applyCollapsedCaret(blockEl: HTMLElement, point: SelectionPoint): void {
	const ambient = ambientLengthOf(blockEl);
	if (ambient > 0 && point.offset <= 0 && placeCaretAfterAmbientSpan(blockEl)) return;
	const dom = rawToDomOffset(point.offset, ambient);
	const range = createRangeFromOffsets(blockEl, dom, dom);
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
	const ambient = ambientLengthOf(blockEl);
	const range = createRangeFromOffsets(
		blockEl,
		rawToDomOffset(startOffset, ambient),
		rawToDomOffset(endOffset, ambient)
	);
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
 * Cross-block from SelectionState if active; otherwise the focused block's
 * cursor as a deep path (via getCursorPosition) or shallow path (fallback).
 * Null when no block reports a cursor.
 */
export function readCurrentSelection(
	selectionState: SelectionState,
	blockRefs: (BlockComponent | undefined)[]
): EditorSelection | null {
	if (selectionState.isCrossBlock && selectionState.anchor && selectionState.focus) {
		return {
			anchor: { path: selectionState.anchor.path.slice(), offset: selectionState.anchor.offset },
			focus: { path: selectionState.focus.path.slice(), offset: selectionState.focus.offset }
		};
	}
	for (let i = 0; i < blockRefs.length; i++) {
		const ref = blockRefs[i];
		if (!ref) continue;
		const pos = ref.getCursorPosition?.();
		if (pos) {
			const path = [i, ...pos.path];
			return {
				anchor: { path, offset: pos.offset },
				focus: { path: [...path], offset: pos.offset }
			};
		}
		const offset = ref.getCursorOffset();
		if (offset !== null && offset !== undefined) {
			return {
				anchor: { path: [i], offset },
				focus: { path: [i], offset }
			};
		}
	}
	return null;
}

/**
 * Restore an EditorSelection to the DOM. Custom-rendered selections
 * (intra-table multi-cell, cross-block) route through SelectionState's
 * overlay; same-path prose ranges use native browser selection.
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

	// isCustomRendered checks the doc node at the path: same-path different-
	// offset on a table/row/cell means cell-index selection, not char range.
	selectionState.enterCrossBlock(selection.anchor, selection.focus);
	if (selectionState.isCustomRendered) {
		// Park caret in the focus block as a paste/key-dispatch anchor; without
		// it Chromium routes paste events to <body>.
		const focusEl = getBlockElByPath(selection.focus.path);
		if (focusEl) {
			applyCollapsedCaret(focusEl, selection.focus);
			focusEl.focus();
		} else {
			clearNativeSelection();
		}
		return;
	}

	selectionState.clear();
	const blockEl = getBlockElByPath(selection.anchor.path);
	if (blockEl) {
		applySingleBlockRange(blockEl, selection.anchor.offset, selection.focus.offset);
		blockEl.focus();
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
	const ambient = ambientLengthOf(blockEl);
	const rangeFromPoint = (
		doc as Document & {
			caretRangeFromPoint?: (x: number, y: number) => Range | null;
		}
	).caretRangeFromPoint?.(clientX, clientY);
	if (rangeFromPoint && blockEl.contains(rangeFromPoint.startContainer)) {
		const dom = domToCharOffset(blockEl, rangeFromPoint.startContainer, rangeFromPoint.startOffset);
		return dom === null ? null : domToRawOffset(dom, ambient);
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
		const dom = domToCharOffset(blockEl, posFromPoint.offsetNode, posFromPoint.offset);
		return dom === null ? null : domToRawOffset(dom, ambient);
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
