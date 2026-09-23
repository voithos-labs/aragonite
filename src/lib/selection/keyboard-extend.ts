/** Cross-block keyboard extension and collapse. Pure helpers over SelectionState. */

import type { SelectionState } from './selection-state.svelte';
import type { SelectedWidgetHandle, SelectedWidgetRange, SelectionPoint } from './primitives';
import type { Document } from '../core/nodes';
import { isVerticallyTransparentNode } from '../core/inline/transparency';
import type { BlockComponent } from '../block-component';
import {
	readNativeCaretInBlock,
	applyCollapsedCaret,
	focusCollapsedCaret,
	applySingleBlockRange,
	clearNativeSelection
} from './native-bridge';
import { offsetFromViewportPoint } from '../cursor/point-offset';
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
import { nodeAt } from '../tree-operations/node-primitives';
import { comparePaths, isStrictAncestorOf, pathsEqual } from './path-math';
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
	// A collapsed caret stays in the focus block, or Chromium sends clipboard events to <body>
	// (as in `parkCaretInFocusBlock`). Best effort: an endpoint with no text position gets no
	// caret, and `components/editor-root-clipboard.ts` covers that case.
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

	// A cell target lands at the cell's own edge and then takes the same caret path as a text
	// leaf. Going through the cell's own `focus` instead would skip the collapse steps, and a
	// byte typed there would join the construct the cell opens with rather than land in front
	// of it. Only the end side overrides the landing's own offset.
	const landing = selection.cellLandingFor(target);
	const point: SelectionPoint =
		to === 'end' && !pathsEqual(landing.path, target.path)
			? { path: landing.path, offset: leafOffsetEnd(doc, landing.path) }
			: landing;

	// `applyCollapsedCaret` clamps the offset so the caret cannot sit past a hidden marker run.
	await revealPath(landing.path);
	focusCollapsedCaret(getBlockElByPath, point);
}

/**
 * Scrolls the focus block into view when it is mounted. Does not mount a windowed-out block
 * itself: the document-edge extend mounts its endpoint through `revealActiveEndpoint` first,
 * and a single Shift+Arrow step lands next to the mounted range.
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
 * Moves the cross-block focus to `target`, or restores the range natively when the focus has
 * come back onto the anchor's own block. Keyboard entry leaves only a collapsed caret, so the
 * range has to be re-created here to stay visible.
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
 * Extends focus to the next leaf in document order (Shift+ArrowDown or Shift+ArrowRight
 * leaving the block), entering cross-block mode if needed. Returns true if focus moved. The
 * vertical axis skips leaves the caret passes over (an image-only paragraph): a range covers
 * one either way. The horizontal axis stops on every leaf, so such a paragraph is selectable
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

/** Select the entire document as a cross-block range (the second Ctrl+A). */
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

	// A one-block document has no cross-block range to paint and `enterCrossBlock` refuses it,
	// so select natively; otherwise a second Ctrl+A would deselect.
	if (!selection.isCustomRendered) {
		selection.collapse();
		const blockEl = getBlockElByPath?.(first);
		if (blockEl) {
			blockEl.focus();
			applySingleBlockRange(blockEl, 0, lastOffset);
		}
		return true;
	}

	// A collapsed caret for paste dispatch, as in `enterCrossBlockFromKeyboard`. A table focus
	// names the table block, whose wrapper holds no caret, so the caret goes in the cell.
	const focus = selection.focus;
	const parkPoint = focus && selection.cellLandingFor(focus);
	const focusBlockEl = parkPoint ? getBlockElByPath?.(parkPoint.path) : null;
	if (focusBlockEl && parkPoint) applyCollapsedCaret(focusBlockEl, parkPoint);
	else clearNativeSelection();
	return true;
}

// ── Shift+Click ────────────────────────────────────────────────────────────

/**
 * Shift+click on a block: extend the cross-block selection, grow a range from an image selected
 * whole, or enter cross-block mode using the previously focused block's caret as the anchor.
 * False when no anchor could be recovered, or the click stayed within the same block (native
 * shift-click handles that).
 */
export function handleShiftClick(
	selection: SelectionState,
	clickedBlockEl: HTMLElement,
	clickedBlockPath: number[],
	clickedX: number,
	clickedY: number,
	previouslyFocusedBlockEl: HTMLElement | null,
	previouslyFocusedBlockPath: number[] | null,
	selectedWidget: SelectedWidgetHandle
): boolean {
	// While an image is selected whole there is no caret to grow from, so the image is the
	// anchor; the press ends that selection either way, as a range and it never coexist.
	const widget = selectedWidget.range();
	if (widget) selectedWidget.clear();
	const clickOffset = offsetFromViewportPoint(clickedBlockEl, clickedX, clickedY);
	if (clickOffset === null) return false;
	const focusPoint: SelectionPoint = { path: clickedBlockPath.slice(), offset: clickOffset };

	if (selection.isCrossBlock) {
		selection.extendFocus(focusPoint);
		return true;
	}

	if (widget) {
		const anchor = widgetShiftAnchor(widget, focusPoint);
		if (comparePaths(anchor.path, focusPoint.path) === 0) {
			applySingleBlockRange(clickedBlockEl, anchor.offset, focusPoint.offset);
			return true;
		}
		selection.enterCrossBlock(anchor, focusPoint);
		applyCollapsedCaret(clickedBlockEl, focusPoint);
		return true;
	}

	if (!previouslyFocusedBlockEl || !previouslyFocusedBlockPath) return false;
	// The anchor path comes from the DOM, and nothing below a table carries a path, so a caret in
	// a cell would read as the table's path with a character offset. The endpoint snap cannot
	// tell that from a cell index, so the path is deepened to the cell here.
	const anchorPath = findCellPathForElement(previouslyFocusedBlockEl) ?? previouslyFocusedBlockPath;
	const anchor = readNativeCaretInBlock(previouslyFocusedBlockEl, anchorPath);
	if (!anchor) return false;

	// Same-block — native selection already produced a single-block range.
	if (comparePaths(anchor.path, focusPoint.path) === 0) return false;

	selection.enterCrossBlock(anchor, focusPoint);
	// A collapsed caret for paste dispatch (see `enterCrossBlockFromKeyboard`); the click's
	// default is not relied on.
	applyCollapsedCaret(clickedBlockEl, focusPoint);
	return true;
}

/** The edge of a selected widget a shift-press grows from: the one away from the press, so the
 *  range covers the widget and everything up to the press. */
export function widgetShiftAnchor(
	widget: SelectedWidgetRange,
	press: SelectionPoint
): SelectionPoint {
	const order = comparePaths(press.path, widget.path);
	const pressAfter = order > 0 || (order === 0 && press.offset > widget.start);
	return { path: widget.path.slice(), offset: pressAfter ? widget.start : widget.end };
}

// ── Internal ───────────────────────────────────────────────────────────────

/** First leaf reachable from `fromPath` going forward (descend or step). */
function firstLeafAfter(doc: Document, fromPath: number[]): number[] | null {
	const next = nextPath(doc, fromPath);
	return next ? firstLeafAtOrAfter(doc, next) : null;
}

/** Last leaf reachable from `fromPath` going backward (descend or step). */
function lastLeafBefore(doc: Document, fromPath: number[]): number[] | null {
	// `previousPath` walks in document order (ancestor before descendant), so a first child's
	// previous is its own container, and descending to that container's last leaf would move
	// forward. Ancestors are skipped until a subtree that truly precedes is reached.
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
 * Starts at the edge leaf itself and steps inward to a text-bearing one, unlike
 * `firstLeafAfter` and `lastLeafBefore`, which step away from their start.
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
