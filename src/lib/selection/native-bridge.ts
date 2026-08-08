/**
 * Bridge between the browser's native Selection API and SelectionPoint. Pure: callers provide
 * target elements and paths, no tree walking. SelectionPoint offsets are raw-semantic, so
 * DOM→raw conversion subtracts the length of a leading ambient marker span, whose textContent
 * counts toward DOM offsets but not raw.
 */

import type { SelectionPoint, EditorSelection } from './primitives';
import type { SelectionState } from './selection-state.svelte';
import type { BlockComponent } from '../block-component';
import { asRawOffset, toClampedRawOffset, toDomTextOffset } from '../cursor/coordinate-spaces';
import {
	createRangeAtDomTextOffsets,
	domTextOffsetAtNode,
	snapOutOfHiddenRun
} from '../cursor/widget-offset';
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
	// The anchor is the fixed end the selection grew from; for a BACKWARD selection it sits at
	// range.end, so reading range.start would capture the moving focus and drop the highlighted
	// span. Use the real anchor when it resolves inside this block, else keep range.start.
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
 * Place a collapsed native caret at a raw-semantic SelectionPoint, translating through the
 * block's ambient length. Raw offset 0 under an ambient marker goes to the boundary AFTER the
 * marker span: the offset walk would land inside its contenteditable="false" text node, which
 * Chromium bounces out of scope. Same landing as the ambient cursor IO's `setToAmbientBoundary`.
 */
export function applyCollapsedCaret(blockEl: HTMLElement, point: SelectionPoint): void {
	const ambient = ambientLengthOf(blockEl);
	if (ambient > 0 && point.offset <= 0 && placeCaretAfterAmbientSpan(blockEl)) return;
	// Forward, like the ambient IO's `setRaw`: a by-path landing on a byte the mode hides
	// belongs at the first visible position after it, not inside the unpainted run.
	const target = snapOutOfHiddenRun(
		blockEl,
		toDomTextOffset(asRawOffset(point.offset), ambient),
		'after'
	);
	const range = createRangeAtDomTextOffsets(blockEl, target, target);
	if (!range) return;
	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(range);
}

/**
 * Resolve `point.path` to its mounted block element and place a focused collapsed caret there.
 * Returns whether an element was found; a missing target is a no-op.
 */
export function focusCollapsedCaret(
	getBlockElByPath: (path: number[]) => HTMLElement | null,
	point: SelectionPoint
): boolean {
	const blockEl = getBlockElByPath(point.path);
	if (!blockEl) return false;
	applyCollapsedCaret(blockEl, point);
	blockEl.focus();
	return true;
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
 * Keep focus inside the editor when an editable block holding it is windowed out; it would
 * otherwise fall to <body>. The root is non-editable (`tabindex="-1"`), so focusing it creates
 * no native range to sync. No-op unless this block holds focus and the root is still connected.
 */
export function parkFocusOnEditorRoot(
	blockEl: HTMLElement | null,
	editorRoot: HTMLElement | null
): void {
	if (!blockEl || !editorRoot?.isConnected) return;
	// preventScroll: the root is the scroll container, so a default focus scroll would fight the
	// reveal path's scrollIntoView.
	if (document.activeElement === blockEl) editorRoot.focus({ preventScroll: true });
}

// ── Selection read/restore for undo ─────────────────────────────────────────

/**
 * Cross-block from SelectionState if active; otherwise the focused block's cursor as a deep
 * path (via getCursorPosition) or a shallow one. Null when no block reports a cursor.
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
 * The focused block's native selection as distinct anchor/focus raw offsets, so getSelection()
 * reports a within-block range instead of collapsing it to the caret. Null when collapsed or
 * outside the active block. Offsets convert through that block's ambient length.
 */
function nativeRangeInFocusedBlock(path: number[]): EditorSelection | null {
	// Node-env callers (undo snapshot capture in unit tests) have no DOM; fall back to the
	// single caret offset rather than touching document/window.
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

// A restored table endpoint must keep cellCoordinate, or it skips the whole-row snap and the
// deep-cell collapse routing; the two-branch copy carries the union variant through undo.
function copySelectionPoint(point: SelectionPoint): SelectionPoint {
	if (point.cellCoordinate) {
		return { path: point.path.slice(), offset: point.offset, cellCoordinate: true };
	}
	return { path: point.path.slice(), offset: point.offset };
}

/**
 * Restore an EditorSelection to the DOM: custom-rendered selections (intra-table, cross-block)
 * route through SelectionState's overlay, same-path prose uses the native selection. State
 * write and caret landing run inside ONE SelectionState batch, so the single notification
 * carries the settled selection. False = the target resolved in the model but not in the DOM.
 */
export function applySelectionToDom(
	selection: EditorSelection,
	selectionState: SelectionState,
	getBlockElByPath: (path: number[]) => HTMLElement | null
): boolean {
	let placed = false;
	selectionState.batch(() => {
		placed = placeRestoredSelection(selection, selectionState, getBlockElByPath);
	});
	return placed;
}

function placeRestoredSelection(
	selection: EditorSelection,
	selectionState: SelectionState,
	getBlockElByPath: (path: number[]) => HTMLElement | null
): boolean {
	// Classify before mutating state so a single-block restore never mints a phantom transient
	// cross-block state (enterCrossBlock → clear).
	const route = selectionState.restoreRoute(selection.anchor, selection.focus);

	if (route === 'collapsed') {
		selectionState.clear();
		return focusCollapsedCaret(getBlockElByPath, selection.anchor);
	}

	if (route === 'single-block') {
		selectionState.clear();
		const blockEl = getBlockElByPath(selection.anchor.path);
		if (!blockEl) return false;
		applySingleBlockRange(blockEl, selection.anchor.offset, selection.focus.offset);
		blockEl.focus();
		return true;
	}

	// Custom: the overlay paints. Park a collapsed caret in the focus block as a paste/key
	// dispatch anchor (Chromium otherwise routes paste to <body>). A cell-coordinate focus
	// addresses the table wrapper by cell index, so park in its deep cell instead.
	selectionState.enterCrossBlock(selection.anchor, selection.focus);
	const cellPath = selectionState.cellDeepPath(selection.focus);
	const parkPath = cellPath ?? selection.focus.path;
	const parkPoint = cellPath ? { path: parkPath, offset: 0 } : selection.focus;
	if (focusCollapsedCaret(getBlockElByPath, parkPoint)) return true;
	clearNativeSelection();
	return false;
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
