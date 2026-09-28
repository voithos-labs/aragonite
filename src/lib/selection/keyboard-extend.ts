/** Cross-block keyboard extension and collapse: `SelectionState` writes plus the native caret. */

import type { SelectionState } from './selection-state.svelte';
import type { SelectedWidgetHandle, SelectedWidgetRange, SelectionPoint } from './primitives';
import type { Document } from '../core/nodes';
import type { GrammarView } from '../schema/block-openers';
import { isVerticallyTransparentNode } from '../core/inline/transparency';
import type { CaretLanding } from './caret-landing';
import {
	readNativeCaretInBlock,
	applyCollapsedCaret,
	applySingleBlockRange,
	clearNativeSelection
} from './native-bridge';
import { offsetFromViewportPoint } from '../cursor/point-offset';
import type { BlockElLookup } from '../editor-keys';
import type { ScrollOwner } from '../cursor/scroll-owner';
import {
	firstPath,
	lastPath,
	firstCaretLeaf,
	lastCaretLeaf,
	nextCaretPath,
	previousCaretPath,
	findCellPathForElement
} from './path-lookup';
import { nodeAt } from '../tree-operations/node-primitives';
import { comparePaths, pathsEqual } from './path-math';
import { displayLength } from '../core/lines';

// ── Enter / Collapse / Scroll ──────────────────────────────────────────────

/** Enters cross-block mode on a Shift+Arrow leaving a block, with the native caret as both
 *  anchor and focus; the caller extends the focus right after. */
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
	// A collapsed caret stays in the focus block, or Chromium sends clipboard events to <body>;
	// an endpoint with no text position gets none, and `editor-root-clipboard.ts` covers it.
	applyCollapsedCaret(currentBlockEl, anchorPoint);
	return true;
}

/** Collapses a cross-block range to its start or end and puts the caret back there as a stored
 *  byte, mounting a windowed-out target and never opening a closed body. */
export async function collapseCrossBlock(
	selection: SelectionState,
	to: 'start' | 'end',
	doc: Document,
	restore: CaretLanding['restore']
): Promise<void> {
	const target = to === 'start' ? selection.start : selection.end;
	if (!target) return;
	selection.collapse();
	clearNativeSelection();

	// A cell target takes the text-leaf caret path: the cell's own `focus` skips the collapse
	// steps, and a byte typed there would join the construct the cell opens with.
	const landing = selection.cellLandingFor(target);
	const point: SelectionPoint =
		to === 'end' && !pathsEqual(landing.path, target.path)
			? { path: landing.path, offset: leafOffsetEnd(doc, landing.path) }
			: landing;
	await restore({ anchor: point, focus: point }, { reveal: 'mount' });
}

/** Scrolls the focus block into view if mounted, without mounting it: a document-edge extend
 *  mounts its endpoint first, and one Shift+Arrow step lands beside the mounted range. */
export function scrollFocusBlockIntoView(
	selection: SelectionState,
	scroll: Pick<ScrollOwner, 'place'>
): void {
	if (selection.focus) {
		void scroll.place(selection.focus.path, { block: 'nearest', hold: false }).scroll();
	}
}

// ── Keyboard Extension ─────────────────────────────────────────────────────

/** Moves the cross-block focus to `target`, or re-creates the range natively when the focus is
 *  back on the anchor's block, since keyboard entry left only a collapsed caret there. */
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

/** Extends focus to the next leaf a caret can reach. The vertical axis skips leaves the caret
 *  passes over (an image-only paragraph); the horizontal stops on each, so it stays selectable. */
export function extendFocusToNextBlock(
	selection: SelectionState,
	doc: Document,
	grammar: GrammarView,
	currentBlockEl: HTMLElement,
	currentBlockPath: number[],
	axis: 'horizontal' | 'vertical' = 'horizontal',
	getBlockElByPath?: BlockElLookup
): boolean {
	const leafTarget =
		axis === 'vertical'
			? firstNonTransparentLeafAfter(doc, grammar, currentBlockPath)
			: nextCaretPath(doc, currentBlockPath);
	if (!leafTarget) return false;

	if (!selection.isCrossBlock) {
		if (!enterCrossBlockFromKeyboard(selection, currentBlockEl, currentBlockPath)) return false;
	}
	extendFocusOrRestore(selection, leafTarget, 0, getBlockElByPath);
	return true;
}

/** Extends focus to the previous leaf: `'end'` crosses the boundary by one character, `'start'`
 *  takes the whole previous line as native ArrowUp does, skipping leaves the caret passes over. */
export function extendFocusToPreviousBlock(
	selection: SelectionState,
	doc: Document,
	grammar: GrammarView,
	currentBlockEl: HTMLElement,
	currentBlockPath: number[],
	side: 'start' | 'end' = 'end',
	getBlockElByPath?: BlockElLookup
): boolean {
	const leafTarget =
		side === 'start'
			? lastNonTransparentLeafBefore(doc, grammar, currentBlockPath)
			: previousCaretPath(doc, currentBlockPath);
	if (!leafTarget) return false;

	if (!selection.isCrossBlock) {
		if (!enterCrossBlockFromKeyboard(selection, currentBlockEl, currentBlockPath)) return false;
	}
	const offset = side === 'start' ? 0 : leafOffsetEnd(doc, leafTarget);
	extendFocusOrRestore(selection, leafTarget, offset, getBlockElByPath);
	return true;
}

/** Extends focus to the document edge; a transparent edge leaf is bypassed for the nearest
 *  text-bearing one, as the one-step extension does. */
export function extendFocusToDocEdge(
	selection: SelectionState,
	doc: Document,
	grammar: GrammarView,
	currentBlockEl: HTMLElement,
	currentBlockPath: number[],
	to: 'start' | 'end',
	getBlockElByPath?: BlockElLookup
): boolean {
	const edge =
		to === 'start' ? firstCaretLeaf(doc, [0]) : lastCaretLeaf(doc, [doc.children.length - 1]);
	if (!edge) return false;

	const target = isTransparent(doc, grammar, edge)
		? to === 'start'
			? firstNonTransparentLeafFrom(doc, grammar, edge)
			: lastNonTransparentLeafFrom(doc, grammar, edge)
		: edge;
	if (!target) return false;

	if (!selection.isCrossBlock) {
		if (!enterCrossBlockFromKeyboard(selection, currentBlockEl, currentBlockPath)) return false;
	}

	const offset = to === 'end' ? leafOffsetEnd(doc, target) : 0;
	extendFocusOrRestore(selection, target, offset, getBlockElByPath);
	return true;
}

/** Selects the entire document as a cross-block range (the second Ctrl+A). */
export function selectWholeDocument(
	selection: SelectionState,
	doc: Document,
	getBlockElByPath?: (path: number[]) => HTMLElement | null
): boolean {
	// Not the caret-reachable order: the range has to cover a closed container's hidden body, so
	// that a delete or a copy of the whole document takes it too.
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

/** Shift+click on a block: extends the range, grows one from an image selected whole, or enters
 *  cross-block mode from the last caret. False for a same-block click, left to the browser. */
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
	// anchor; the click ends that selection either way, as a range and it never coexist.
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
	// Nothing below a table carries a path, so a caret in a cell would read as the table's path
	// with a character offset, which the endpoint snap can't tell from a cell index.
	const anchorPath = findCellPathForElement(previouslyFocusedBlockEl) ?? previouslyFocusedBlockPath;
	const anchor = readNativeCaretInBlock(previouslyFocusedBlockEl, anchorPath);
	if (!anchor) return false;

	// Same block: the browser's own shift-click already made the range.
	if (comparePaths(anchor.path, focusPoint.path) === 0) return false;

	selection.enterCrossBlock(anchor, focusPoint);
	// A collapsed caret for paste dispatch (see `enterCrossBlockFromKeyboard`); the click's
	// default is not relied on.
	applyCollapsedCaret(clickedBlockEl, focusPoint);
	return true;
}

/** The edge of a selected widget a shift-click grows from: the one away from the click, so the
 *  range covers the widget and everything up to the click. */
export function widgetShiftAnchor(
	widget: SelectedWidgetRange,
	press: SelectionPoint
): SelectionPoint {
	const order = comparePaths(press.path, widget.path);
	const pressAfter = order > 0 || (order === 0 && press.offset > widget.start);
	return { path: widget.path.slice(), offset: pressAfter ? widget.start : widget.end };
}

// ── Internal ───────────────────────────────────────────────────────────────

function isTransparent(doc: Document, grammar: GrammarView, path: number[]): boolean {
	const node = nodeAt(doc, path);
	// nodeAt returns the Document for an empty path; narrow it out (Document has no `raw`).
	return node !== null && 'raw' in node && isVerticallyTransparentNode(node, grammar);
}

function firstNonTransparentLeafAfter(
	doc: Document,
	grammar: GrammarView,
	fromPath: number[]
): number[] | null {
	let leaf = nextCaretPath(doc, fromPath);
	while (leaf && isTransparent(doc, grammar, leaf)) {
		leaf = nextCaretPath(doc, leaf);
	}
	return leaf;
}

function lastNonTransparentLeafBefore(
	doc: Document,
	grammar: GrammarView,
	fromPath: number[]
): number[] | null {
	let leaf = previousCaretPath(doc, fromPath);
	while (leaf && isTransparent(doc, grammar, leaf)) {
		leaf = previousCaretPath(doc, leaf);
	}
	return leaf;
}

/** Starts at the edge leaf itself and steps inward, unlike `nextCaretPath` and
 *  `previousCaretPath`, which step away from their start. */
function firstNonTransparentLeafFrom(
	doc: Document,
	grammar: GrammarView,
	startPath: number[]
): number[] | null {
	if (!isTransparent(doc, grammar, startPath)) return startPath;
	return firstNonTransparentLeafAfter(doc, grammar, startPath);
}

function lastNonTransparentLeafFrom(
	doc: Document,
	grammar: GrammarView,
	startPath: number[]
): number[] | null {
	if (!isTransparent(doc, grammar, startPath)) return startPath;
	return lastNonTransparentLeafBefore(doc, grammar, startPath);
}

function leafOffsetEnd(doc: Document, path: number[]): number {
	const node = nodeAt(doc, path);
	if (!node || !('raw' in node) || typeof node.raw !== 'string') return 0;
	// raw includes a trailing newline; the cursor works in display space.
	return displayLength(node.raw);
}
