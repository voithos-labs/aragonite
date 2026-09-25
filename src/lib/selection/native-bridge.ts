/**
 * Bridges the browser's Selection API and `SelectionPoint`. Callers provide the elements and
 * paths; nothing here walks the tree. A `SelectionPoint` offset counts raw bytes, so the
 * DOM-to-raw conversion subtracts a container's leading marker span, whose text counts toward
 * DOM offsets but not raw.
 */

import type { SelectionPoint, EditorSelection } from './primitives';
import type { SelectionState } from './selection-state.svelte';
import type { BlockComponent } from '../block-component';
import {
	asDomTextOffset,
	asRawOffset,
	toClampedRawOffset,
	toDomTextOffset
} from '../cursor/coordinate-spaces';
import { createRangeFromOffsets } from '../cursor/content-offsets';
import {
	clampToLandableRaw,
	createRangeAtDomTextOffsets,
	domTextOffsetAtNode
} from '../cursor/widget-offset';
import {
	ambientLengthOf,
	ambientSpanOf,
	placeCaretAfterAmbientSpan,
	pointAfterAmbientSpan
} from '../ambient/ambient-dom';

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
	// The anchor is the fixed end the selection grew from; in a backward selection it sits at
	// the range's end, so reading the range's start would capture the moving focus instead. The
	// real anchor is used when it lies inside this block, else the range start.
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
 * Places a collapsed native caret at a `SelectionPoint`, clamped as `parkCaret` clamps: never
 * past a hidden marker run. Raw offset 0 behind a marker span goes after the span, because
 * Chromium bounces a caret out of `contenteditable="false"`.
 */
export function applyCollapsedCaret(blockEl: HTMLElement, point: SelectionPoint): void {
	const ambient = ambientLengthOf(blockEl);
	const offset = clampToLandableRaw(blockEl, point.offset, ambient);
	if (ambient > 0 && offset <= 0 && placeCaretAfterAmbientSpan(blockEl)) return;
	const target = toDomTextOffset(asRawOffset(offset), ambient);
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

/** Selects an editable element's whole content, past its marker prefix: the first Ctrl+A
 *  range and the triple-click one. */
export function applySurfaceContentRange(el: HTMLElement): void {
	const ambient = ambientSpanOf(el);
	const ambientLen = ambient?.textContent?.length ?? 0;
	const textLen = el.textContent?.length ?? 0;

	if (ambient && textLen > ambientLen) {
		if (!placeCaretAfterAmbientSpan(el)) return;
		// `textLen` counts the full textContent, marker included, so it is already a DOM text offset.
		const endRange = createRangeFromOffsets(el, asDomTextOffset(textLen), asDomTextOffset(textLen));
		if (endRange) {
			window.getSelection()?.extend(endRange.endContainer, endRange.endOffset);
		}
		return;
	}

	const range = document.createRange();
	range.selectNodeContents(el);
	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(range);
}

/** Selects raw `[anchorOffset, focusOffset]` in one block, backward when the focus comes first. */
export function applySingleBlockRange(
	blockEl: HTMLElement,
	anchorOffset: number,
	focusOffset: number
): void {
	const startOffset = Math.min(anchorOffset, focusOffset);
	const ambient = ambientLengthOf(blockEl);
	const range = createRangeAtDomTextOffsets(
		blockEl,
		toDomTextOffset(asRawOffset(startOffset), ambient),
		toDomTextOffset(asRawOffset(Math.max(anchorOffset, focusOffset)), ambient)
	);
	if (!range) return;
	const sel = window.getSelection();
	// A start at raw 0 behind a marker span goes after the span, as a caret does: Chromium drops
	// a range that opens inside `contenteditable="false"`.
	const afterMarker = ambient > 0 && startOffset <= 0 ? pointAfterAmbientSpan(blockEl) : null;
	const start = afterMarker ?? { node: range.startContainer, offset: range.startOffset };
	if (focusOffset < anchorOffset) {
		sel?.setBaseAndExtent(range.endContainer, range.endOffset, start.node, start.offset);
		return;
	}
	if (afterMarker) {
		sel?.setBaseAndExtent(start.node, start.offset, range.endContainer, range.endOffset);
		return;
	}
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
	// `preventScroll`: the focus call's own scroll would fight the scroll-into-view that mounts
	// the block.
	if (document.activeElement === blockEl) editorRoot.focus({ preventScroll: true });
}

// ── Selection read/restore ───────────────────────────────────────────────────

/**
 * The editor's live selection, for every reader outside a gesture: a selected image's caret
 * first, then the cross-block range, then the focused block's cursor. Null when nothing answers.
 * The image comes first because the browser puts a caret back at its paragraph's start, which
 * the editor drops a moment later.
 */
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

/**
 * The focused block's native selection as distinct anchor/focus raw offsets, so getSelection()
 * reports a within-block range instead of collapsing it to the caret. Null when collapsed or
 * outside the active block. Offsets convert through that block's leading marker length.
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

// A restored table endpoint must keep `cellCoordinate`, or it skips the whole-row snap and the
// collapse into the cell; the two branches keep the union variant intact through undo.
function copySelectionPoint(point: SelectionPoint): SelectionPoint {
	if (point.cellCoordinate) {
		return { path: point.path.slice(), offset: point.offset, cellCoordinate: true };
	}
	return { path: point.path.slice(), offset: point.offset };
}

/**
 * Restores an `EditorSelection` to the DOM: a selection the overlay paints (inside a table,
 * cross-block) goes through `SelectionState`, a same-block text range through the native
 * selection. The state write and the caret placement run in one `SelectionState` batch, so the
 * single notification carries the final selection. False means the target resolved in the
 * model but not in the DOM.
 */
export function applySelectionToDom(
	selection: EditorSelection,
	selectionState: SelectionState,
	getBlockElByPath: (path: number[]) => HTMLElement | null
): boolean {
	let placed = false;
	selectionState.batch(() => {
		placed = placeRestoredSelection(selection, selectionState, getBlockElByPath);
		// Announced explicitly: a restore onto an already clear state changes no field of the
		// selection state and still moves the caret that subscribers read back.
		selectionState.announceSelection();
	});
	return placed;
}

function placeRestoredSelection(
	selection: EditorSelection,
	selectionState: SelectionState,
	getBlockElByPath: (path: number[]) => HTMLElement | null
): boolean {
	// Classify before touching state, so a single-block restore never passes through a transient
	// cross-block state (`enterCrossBlock` then `clear`).
	const route = selectionState.restoreRoute(selection.anchor, selection.focus);

	if (route === 'collapsed') {
		selectionState.clear();
		// Through `cellLandingFor`, as in the overlay branch below: a collapsed cell point reaches
		// here (equal offsets classify before coordinate space does) carrying a cell index, which
		// a character walk over the table wrapper would put somewhere in the grid's text.
		return focusCollapsedCaret(getBlockElByPath, selectionState.cellLandingFor(selection.anchor));
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

	// The overlay paints the range. A collapsed caret goes in the focus block so paste and key
	// events dispatch there (Chromium otherwise routes paste to <body>); a cell-coordinate focus
	// names the table wrapper, so the caret goes in the cell instead.
	selectionState.enterCrossBlock(selection.anchor, selection.focus);
	if (focusCollapsedCaret(getBlockElByPath, selectionState.cellLandingFor(selection.focus))) {
		return true;
	}
	clearNativeSelection();
	return false;
}
