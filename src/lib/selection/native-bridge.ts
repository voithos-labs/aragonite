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
import { asRawOffset, toClampedRawOffset, toDomTextOffset } from '../cursor/coordinate-spaces';
import { createRangeAtDomTextOffsets, domTextOffsetAtNode } from '../cursor/widget-offset';
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
	if (document.activeElement !== blockEl) return null;
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return null;
	const range = sel.getRangeAt(0);
	// The anchor is the fixed end the selection grew from; for a BACKWARD
	// selection (anchor after focus) it sits at range.end, so reading range.start
	// captures the moving focus instead and cross-block entry drops the
	// highlighted span. Read the real anchor when it's a resolvable node inside
	// this block; a collapsed caret (or an anchor in a sibling) keeps range.start.
	const useAnchor = !sel.isCollapsed && sel.anchorNode !== null && blockEl.contains(sel.anchorNode);
	const node = useAnchor ? sel.anchorNode! : range.startContainer;
	const nodeOffset = useAnchor ? sel.anchorOffset : range.startOffset;
	const content = domTextOffsetAtNode(blockEl, node, nodeOffset);
	return {
		path: path.slice(),
		offset: toClampedRawOffset(content, ambientLengthOf(blockEl))
	};
}

// ── Apply SelectionPoint → native ───────────────────────────────────────────

/**
 * Place a collapsed native caret at a raw-semantic SelectionPoint. Translates
 * through the block's ambient length (0 when no marker island is present).
 * Raw offset 0 under an ambient marker is placed at the sibling boundary AFTER
 * the marker span — the offset walk would otherwise land in the marker's
 * contenteditable="false" text node, and Chromium bounces the caret out of
 * scope. Same landing as the ambient cursor IO's `setToAmbientBoundary`.
 */
export function applyCollapsedCaret(blockEl: HTMLElement, point: SelectionPoint): void {
	const ambient = ambientLengthOf(blockEl);
	if (ambient > 0 && point.offset <= 0 && placeCaretAfterAmbientSpan(blockEl)) return;
	const target = toDomTextOffset(asRawOffset(point.offset), ambient);
	const range = createRangeAtDomTextOffsets(blockEl, target, target);
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
	const range = createRangeAtDomTextOffsets(
		blockEl,
		toDomTextOffset(asRawOffset(startOffset), ambient),
		toDomTextOffset(asRawOffset(endOffset), ambient)
	);
	if (!range) return;
	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(range);
}

export function clearNativeSelection(): void {
	window.getSelection()?.removeAllRanges();
}

/**
 * When an editable block holding native focus is windowed out, focus would
 * fall to <body> (outside `.editor`) and the editor-root keydown listener's
 * activeElement guard would still route — but focusing the editor root keeps
 * the focused state inside the editor and avoids body-scoped quirks. The root
 * is non-editable (`tabindex="-1"`), so focusing it creates no native range to
 * sync. No-op unless this block actually holds focus and the root is still in
 * the document (skips full-editor teardown, where the root is gone too).
 */
export function parkFocusOnEditorRoot(
	blockEl: HTMLElement | null,
	editorRoot: HTMLElement | null
): void {
	if (!blockEl || !editorRoot?.isConnected) return;
	// preventScroll: the root is the scroll container, so a default focus scroll
	// would fight the reveal path's scrollIntoView.
	if (document.activeElement === blockEl) editorRoot.focus({ preventScroll: true });
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
			anchor: copySelectionPoint(selectionState.anchor),
			focus: copySelectionPoint(selectionState.focus)
		};
	}
	for (let i = 0; i < blockRefs.length; i++) {
		const ref = blockRefs[i];
		if (!ref) continue;
		const pos = ref.getCursorPosition?.();
		if (pos) {
			const path = [i, ...pos.path];
			return nativeRangeInFocusedBlock(path) ?? collapsedSelectionAt(path, pos.offset);
		}
		const offset = ref.getCursorOffset();
		if (offset !== null && offset !== undefined) {
			return nativeRangeInFocusedBlock([i]) ?? collapsedSelectionAt([i], offset);
		}
	}
	return null;
}

function collapsedSelectionAt(path: number[], offset: number): EditorSelection {
	return { anchor: { path: path.slice(), offset }, focus: { path: path.slice(), offset } };
}

/**
 * The focused block's native selection as distinct anchor/focus raw offsets, so
 * getSelection() reports a within-block range instead of collapsing it to the
 * caret. Null when the selection is collapsed or not inside the active block —
 * callers fall back to the single caret offset. `path` addresses the leaf whose
 * contenteditable holds native focus; offsets convert through its ambient length,
 * the single offset-arithmetic home.
 */
function nativeRangeInFocusedBlock(path: number[]): EditorSelection | null {
	// Node-env callers (undo snapshot capture in unit tests) have no DOM; fall
	// back to the single caret offset rather than touching document/window.
	if (typeof document === 'undefined' || typeof window === 'undefined') return null;
	const active = document.activeElement;
	if (!(active instanceof HTMLElement)) return null;
	const sel = window.getSelection();
	if (!sel || sel.isCollapsed || sel.anchorNode === null || sel.focusNode === null) return null;
	if (!active.contains(sel.anchorNode) || !active.contains(sel.focusNode)) return null;
	const ambient = ambientLengthOf(active);
	const anchorOffset = toClampedRawOffset(
		domTextOffsetAtNode(active, sel.anchorNode, sel.anchorOffset),
		ambient
	);
	const focusOffset = toClampedRawOffset(
		domTextOffsetAtNode(active, sel.focusNode, sel.focusOffset),
		ambient
	);
	return {
		anchor: { path: path.slice(), offset: anchorOffset },
		focus: { path: path.slice(), offset: focusOffset }
	};
}

// A restored table endpoint must keep cellCoordinate, or it skips the whole-row
// snap and the deep-cell collapse routing; the two-branch copy carries the union
// variant through the undo snapshot.
function copySelectionPoint(point: SelectionPoint): SelectionPoint {
	if (point.cellCoordinate) {
		return { path: point.path.slice(), offset: point.offset, cellCoordinate: true };
	}
	return { path: point.path.slice(), offset: point.offset };
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
	// Classify before mutating state so a single-block restore never emits a
	// phantom transient cross-block selectionChange (enterCrossBlock → clear).
	const route = selectionState.restoreRoute(selection.anchor, selection.focus);

	if (route === 'collapsed') {
		selectionState.clear();
		const blockEl = getBlockElByPath(selection.anchor.path);
		if (blockEl) {
			applyCollapsedCaret(blockEl, selection.anchor);
			blockEl.focus();
		}
		return;
	}

	if (route === 'single-block') {
		selectionState.clear();
		const blockEl = getBlockElByPath(selection.anchor.path);
		if (blockEl) {
			applySingleBlockRange(blockEl, selection.anchor.offset, selection.focus.offset);
			blockEl.focus();
		}
		return;
	}

	// Custom: cross-block or intra-table cell rect → the overlay paints. Park a
	// collapsed caret in the focus block as a paste/key-dispatch anchor (Chromium
	// otherwise routes paste to <body>). A cell-coordinate focus addresses the
	// table wrapper by linear cell index, so park in its deep cell — a char-walk
	// with the cell index would land the caret in the wrong place.
	selectionState.enterCrossBlock(selection.anchor, selection.focus);
	const cellPath = selectionState.cellDeepPath(selection.focus);
	const parkPath = cellPath ?? selection.focus.path;
	const focusEl = getBlockElByPath(parkPath);
	if (focusEl) {
		applyCollapsedCaret(focusEl, cellPath ? { path: parkPath, offset: 0 } : selection.focus);
		focusEl.focus();
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
	const ambient = ambientLengthOf(blockEl);
	const rangeFromPoint = (
		doc as Document & {
			caretRangeFromPoint?: (x: number, y: number) => Range | null;
		}
	).caretRangeFromPoint?.(clientX, clientY);
	if (rangeFromPoint && blockEl.contains(rangeFromPoint.startContainer)) {
		const content = domTextOffsetAtNode(
			blockEl,
			rangeFromPoint.startContainer,
			rangeFromPoint.startOffset
		);
		return toClampedRawOffset(content, ambient);
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
		const content = domTextOffsetAtNode(blockEl, posFromPoint.offsetNode, posFromPoint.offset);
		return toClampedRawOffset(content, ambient);
	}
	return null;
}
