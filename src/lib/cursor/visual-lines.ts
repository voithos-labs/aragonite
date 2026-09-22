/**
 * Whether the cursor sits on the first or last visual line of a wrapping element. Offsets alone
 * can't answer it past 2 wrapped lines, so the cursor's line is compared to the edge line's.
 * Collapsed ranges beside non-text children (dimmed markers, atomic widgets) measure to nothing,
 * so the edge line is measured around real text, and a rect-less caret borrows the box it sits
 * against; that borrowed box and the line tolerance are declared here once.
 */

import { domDescendants } from './dom-walk';
import { FALLBACK_LINE_HEIGHT } from './typography-estimates';
import { isHiddenMarkerText } from './widget-offset';

// Fraction of a line height within which the cursor Y counts as the boundary line; under one
// line, so sub/superscript or inline-image jitter doesn't read as a different line.
const SAME_LINE_TOLERANCE = 0.8;

/** The first rect that can position a caret: the leading client rect when it has real
 *  height, else the bounding rect. `widthTolerant` also accepts a zero-height rect with width. */
export function firstUsefulRect(range: Range, widthTolerant = true): DOMRect | null {
	const rects = range.getClientRects();
	if (rects.length > 0 && rects[0].height > 0) return rects[0] as DOMRect;
	const br = range.getBoundingClientRect();
	if (br.height > 0 || (widthTolerant && br.width > 0)) return br;
	return null;
}

export function getRangeTop(range: Range): number | null {
	return firstUsefulRect(range, false)?.top ?? null;
}

/** The box a caret sits in: what the line comparisons and the sticky column both read of it. */
export interface CaretRect {
	/** The caret's x. For a caret borrowing a widget's box, the edge it sits on. */
	left: number;
	top: number;
	bottom: number;
}

/**
 * The box a caret with no rect of its own borrows: the widget it precedes, else the one it
 * follows. Null where the caret is not at an element-level position, or the neighbour measures
 * to nothing.
 */
export function neighbourCaretRect(range: Range): CaretRect | null {
	const container = range.startContainer;
	if (container.nodeType !== Node.ELEMENT_NODE) return null;
	const children = container.childNodes;
	return (
		nodeCaretRect(children[range.startOffset], false) ??
		nodeCaretRect(children[range.startOffset - 1], true)
	);
}

/** How far apart two carets' boxes may sit and still read as one visual line: under one line of
 *  the element's own leading, so sub/superscript or inline-image jitter is not a new line. */
export function sameLineTolerance(el: HTMLElement): number {
	const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || FALLBACK_LINE_HEIGHT;
	return lineHeight * SAME_LINE_TOLERANCE;
}

/** Non-collapsed ranges reliably return rects where collapsed ones don't. */
export function getCharRangeTop(container: Node, offset: number, atEnd: boolean): number | null {
	try {
		const range = document.createRange();
		if (atEnd) {
			range.setStart(container, Math.max(0, offset - 1));
			range.setEnd(container, offset);
		} else {
			range.setStart(container, offset);
			range.setEnd(container, offset + 1);
		}
		return firstUsefulRect(range)?.top ?? null;
	} catch {
		// offset out of bounds
	}
	return null;
}

/** Skips non-text children (dimmed marker spans) that would otherwise leave the block's
 *  first line unmeasurable, and hidden marker text, which measures to no rect at all. */
export function findFirstTextNode(root: Node): Text | null {
	return measurableText(root, containerOf(root), false);
}

export function findLastTextNode(root: Node): Text | null {
	return measurableText(root, containerOf(root), true);
}

/**
 * True if the selection inside `el` sits on the first visual line; empty containers return true.
 * `fallbackOffset` (the snapped caret offset from `ambient-cursor.getRaw`) answers when there is
 * no live range, since Chromium drops the caret range next to atomic contenteditable=false
 * widgets across event-loop yields. It is compared against the block's first offset the caret
 * can sit at, which a leading hidden run moves off raw 0.
 */
export function isAtFirstVisualLine(
	el: HTMLElement,
	fallbackOffset: number,
	contentStart: number
): boolean {
	return isAtEdgeVisualLine(el, () => fallbackOffset <= contentStart, {
		isEmpty: (el.textContent ?? '').length === 0,
		toStart: true,
		boundaryTop: () => {
			const firstText = findFirstTextNode(el);
			const top = firstText ? getCharRangeTop(firstText, 0, false) : null;
			return top ?? collapsedContentsTop(el, true);
		}
	});
}

export function isAtLastVisualLine(
	el: HTMLElement,
	fallbackOffset: number,
	contentEnd: number
): boolean {
	return isAtEdgeVisualLine(el, () => fallbackOffset >= contentEnd, {
		isEmpty: contentEnd === 0,
		toStart: false,
		boundaryTop: () => {
			const lastText = findLastTextNode(el);
			const top = lastText ? getCharRangeTop(lastText, lastText.textContent!.length, true) : null;
			return top ?? collapsedContentsTop(el, false);
		}
	});
}

// ── Internal ────────────────────────────────────────────────────────────────

/** The shared skeleton of the two edge predicates: `fallback` answers where geometry cannot (a
 *  dropped range, a caret no box can be found for, an unmeasurable boundary line) and
 *  `boundaryTop` measures the edge line each side's own way. */
function isAtEdgeVisualLine(
	el: HTMLElement,
	fallback: () => boolean,
	edge: { isEmpty: boolean; toStart: boolean; boundaryTop: () => number | null }
): boolean {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return fallback();
	if (edge.isEmpty) return true;

	const cursorRange = sel.getRangeAt(0);
	const tolerance = sameLineTolerance(el);
	const cursorTop = getRangeTop(cursorRange);

	if (cursorTop === null) {
		if (!cursorRange.collapsed) return true;
		// A caret beside an atomic widget sits at an element-level position and measures to no rect
		// of its own: it borrows the widget's box, and is at the edge line when nothing reaches past.
		const band = neighbourCaretRect(cursorRange);
		const contents = contentsRect(el);
		if (!band || !contents) return fallback();
		return edge.toStart
			? band.top < contents.top + tolerance
			: band.bottom > contents.bottom - tolerance;
	}

	const edgeTop = edge.boundaryTop();
	if (edgeTop === null) return fallback();
	return Math.abs(cursorTop - edgeTop) < tolerance;
}

function nodeCaretRect(node: Node | undefined, fromEnd: boolean): CaretRect | null {
	if (!node) return null;
	const range = document.createRange();
	range.selectNode(node);
	// A node that wraps has one rect per line, and the caret touches the line on its own side.
	const rects = range.getClientRects();
	const rect =
		rects.length === 0 ? range.getBoundingClientRect() : rects[fromEnd ? rects.length - 1 : 0];
	return caretRectOf(rect, fromEnd);
}

function contentsRange(el: HTMLElement): Range {
	const range = document.createRange();
	range.selectNodeContents(el);
	return range;
}

function contentsRect(el: HTMLElement): CaretRect | null {
	return caretRectOf(contentsRange(el).getBoundingClientRect(), false);
}

function caretRectOf(rect: DOMRect, fromEnd: boolean): CaretRect | null {
	if (rect.height <= 0) return null;
	return { left: fromEnd ? rect.right : rect.left, top: rect.top, bottom: rect.bottom };
}

/** The boundary line's collapsed-contents fallback measurement. */
function collapsedContentsTop(el: HTMLElement, toStart: boolean): number | null {
	const range = contentsRange(el);
	range.collapse(toStart);
	return getRangeTop(range);
}

/** Deciding whether text is a hidden marker needs the walk container; a bare text-node root has none. */
function containerOf(root: Node): HTMLElement | null {
	return root instanceof HTMLElement ? root : null;
}

function measurableText(node: Node, container: HTMLElement | null, fromEnd: boolean): Text | null {
	for (const current of domDescendants(node, undefined, { fromEnd })) {
		if (current.nodeType !== Node.TEXT_NODE) continue;
		if (isMeasurableText(current as Text, container)) return current as Text;
	}
	return null;
}

function isMeasurableText(text: Text, container: HTMLElement | null): boolean {
	if ((text.textContent?.length ?? 0) === 0) return false;
	return container === null || !isHiddenMarkerText(text, container);
}
