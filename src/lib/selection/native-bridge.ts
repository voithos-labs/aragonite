/**
 * Bridges the browser's Selection API and `SelectionPoint`. Callers provide the elements and
 * paths; nothing here walks the tree. A `SelectionPoint` offset counts raw bytes, and every
 * conversion goes through `cursor/widget-offset.ts`.
 */

import { cellPoint, type SelectionPoint, type EditorSelection } from './primitives';
import type { SelectionState } from './selection-state.svelte';
import type { BlockComponent } from '../block-component';
import {
	placeCaretAtRaw,
	rawOffsetAt,
	selectRawRange,
	selectSurfaceContent
} from '../cursor/widget-offset';

// ── Read native → SelectionPoint ────────────────────────────────────────────

/** Reads the caret inside `blockEl` as a raw-offset point; null when the caret is elsewhere. */
export function readNativeCaretInBlock(
	blockEl: HTMLElement,
	path: number[]
): SelectionPoint | null {
	if (document.activeElement !== blockEl) return null;
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return null;
	const range = sel.getRangeAt(0);
	// In a backward selection the anchor sits at the range's end, so the range start would be the
	// moving focus; the real anchor is used whenever it lies inside the block.
	const useAnchor = !sel.isCollapsed && sel.anchorNode !== null && blockEl.contains(sel.anchorNode);
	const node = useAnchor ? sel.anchorNode! : range.startContainer;
	const nodeOffset = useAnchor ? sel.anchorOffset : range.startOffset;
	return { path: path.slice(), offset: rawOffsetAt(blockEl, node, nodeOffset) };
}

// ── Apply SelectionPoint → native ───────────────────────────────────────────

/** Places a collapsed native caret at a `SelectionPoint`, clamped as `parkCaret` clamps: never
 *  behind a hidden marker run. */
export function applyCollapsedCaret(blockEl: HTMLElement, point: SelectionPoint): void {
	placeCaretAtRaw(blockEl, point.offset, { clamp: 'reachable' });
}

/** Places a focused collapsed caret in `point`'s mounted block; false when it is not mounted.
 *  Exported only for the cross-block delete, typing and paste, which still place their own caret. */
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

/** Selects an editable element's whole content, past its marker prefix: the first Ctrl+A
 *  range and the triple-click one. */
export function applySurfaceContentRange(el: HTMLElement): void {
	selectSurfaceContent(el);
}

/** Selects raw `[anchorOffset, focusOffset]` in one block, backward when the focus comes first. */
export function applySingleBlockRange(
	blockEl: HTMLElement,
	anchorOffset: number,
	focusOffset: number
): void {
	selectRawRange(blockEl, anchorOffset, focusOffset);
}

export function clearNativeSelection(): void {
	window.getSelection()?.removeAllRanges();
}

/** Keeps focus in the editor when a focused block is windowed out, or it would fall to <body>.
 *  The root is non-editable, so focusing it creates no native range to sync. */
export function parkFocusOnEditorRoot(
	blockEl: HTMLElement | null,
	editorRoot: HTMLElement | null
): void {
	if (!blockEl || !editorRoot?.isConnected) return;
	// `preventScroll`: the focus call's own scroll would fight the scroll-into-view that mounts
	// the block.
	if (document.activeElement === blockEl) editorRoot.focus({ preventScroll: true });
}

// ── Selection read/restore ───────────────────────────────────────────────────

/** The editor's live selection, for every caller outside a gesture. A selected image comes first:
 *  the browser briefly puts a caret at its paragraph's start, which the editor then drops. */
export function readCurrentSelection(
	selectionState: SelectionState,
	blockRefs: (BlockComponent | undefined)[],
	selectedWidgetCaret: () => EditorSelection | null
): EditorSelection | null {
	const widget = selectedWidgetCaret();
	if (widget) {
		return { anchor: copySelectionPoint(widget.anchor), focus: copySelectionPoint(widget.focus) };
	}
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

/** The focused block's native selection as distinct raw offsets, so a within-block range is not
 *  reported collapsed to the caret. Null when collapsed or outside the active block. */
function nativeRangeInFocusedBlock(path: number[]): EditorSelection | null {
	// Node-env callers (undo snapshot capture in unit tests) have no DOM; fall back to the
	// single caret offset rather than touching document/window.
	if (typeof document === 'undefined' || typeof window === 'undefined') return null;
	const active = document.activeElement;
	if (!(active instanceof HTMLElement)) return null;
	const sel = window.getSelection();
	if (!sel || sel.isCollapsed || sel.anchorNode === null || sel.focusNode === null) return null;
	if (!active.contains(sel.anchorNode) || !active.contains(sel.focusNode)) return null;
	return {
		anchor: { path: path.slice(), offset: rawOffsetAt(active, sel.anchorNode, sel.anchorOffset) },
		focus: { path: path.slice(), offset: rawOffsetAt(active, sel.focusNode, sel.focusOffset) }
	};
}

// A restored table endpoint must keep `cellCoordinate`, or it skips the whole-row snap and the
// collapse into the cell; the two branches keep the union variant intact through undo.
function copySelectionPoint(point: SelectionPoint): SelectionPoint {
	if (point.cellCoordinate) {
		return cellPoint(point.path, point.offset);
	}
	return { path: point.path.slice(), offset: point.offset };
}

/** What a restore writes into, beside the selection state. */
export interface RestoreTarget {
	selectionState: SelectionState;
	getBlockElByPath: (path: number[]) => HTMLElement | null;
	/** Where the caret goes for an endpoint: the leaf a caret can sit in, never a hidden one. */
	caretAt: (point: SelectionPoint) => SelectionPoint;
	/** Takes focus for a block held whole, which has no text for a caret, as a drag leaves it. */
	getEditorRoot: () => HTMLElement | null;
}

/** Restores an `EditorSelection` to the DOM in one `SelectionState` batch, so the single
 *  notification carries the final selection. False when the target is not mounted. */
export function applySelectionToDom(selection: EditorSelection, target: RestoreTarget): boolean {
	let placed = false;
	target.selectionState.batch(() => {
		placed = placeRestoredSelection(selection, target);
		// Announced explicitly: a restore onto an already clear state changes no field of the
		// selection state and still moves the caret that subscribers read back.
		target.selectionState.announceSelection();
	});
	return placed;
}

function placeRestoredSelection(selection: EditorSelection, target: RestoreTarget): boolean {
	const { selectionState, getBlockElByPath } = target;
	// Classify before touching state, so a single-block restore never passes through a transient
	// cross-block state (`enterCrossBlock` then `clear`).
	const route = selectionState.restoreRoute(selection.anchor, selection.focus);

	if (route === 'collapsed') {
		selectionState.clear();
		return focusCollapsedCaret(getBlockElByPath, target.caretAt(selection.anchor));
	}

	if (route === 'whole-block') {
		const whole = { path: selection.anchor.path.slice(), wholeBlock: true as const };
		selectionState.enterCrossBlock(whole, whole);
		clearNativeSelection();
		const root = target.getEditorRoot();
		root?.focus({ preventScroll: true });
		return root !== null;
	}

	// No cell translation here: a same-path pair inside a table routes to the overlay, so every
	// pair reaching this branch is a character range on a text leaf.
	if (route === 'single-block') {
		selectionState.clear();
		const blockEl = getBlockElByPath(selection.anchor.path);
		if (!blockEl) return false;
		applySingleBlockRange(blockEl, selection.anchor.offset, selection.focus.offset);
		blockEl.focus();
		return true;
	}

	// The overlay paints the range; a collapsed caret in the focus block (or its cell) gives paste
	// and key events a target, since Chromium otherwise routes paste to <body>.
	selectionState.enterCrossBlock(selection.anchor, selection.focus);
	// The stored focus, which normalization may have turned into a cell index.
	const focus = selectionState.focus ?? selection.focus;
	if (focusCollapsedCaret(getBlockElByPath, target.caretAt(focus))) {
		return true;
	}
	clearNativeSelection();
	return false;
}
