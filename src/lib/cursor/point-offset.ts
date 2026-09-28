/**
 * Viewport point to caret offset inside one element. The browser finds the DOM position, and
 * `widget-offset.ts`'s walk does the arithmetic: this module computes no offset of its own, so
 * an atomic widget and a leading marker prefix count here exactly as they do for a live caret read.
 */

import { rawOffsetAt } from './widget-offset';

/** The caret offset in `el` nearest a viewport point, clamped into `el`'s box first so a click on
 *  the frame still names one. Null where `el` holds no text. */
export function caretOffsetAtPoint(
	el: HTMLElement,
	clientX: number,
	clientY: number
): number | null {
	const probe = clampPointIntoBox(el.getBoundingClientRect(), clientX, clientY);
	return offsetFromViewportPoint(el, probe.x, probe.y);
}

/**
 * The exact counterpart: null for a point outside `el`, which a hit test must decline rather
 * than round into the nearest offset. A point inside `el` is first moved level with its lines.
 */
export function offsetFromViewportPoint(
	blockEl: HTMLElement,
	clientX: number,
	clientY: number
): number | null {
	const seat = caretSeatInElement(blockEl, clientX, clientY);
	if (!seat || !blockEl.contains(seat.node)) return null;
	return rawOffsetAt(blockEl, seat.node, seat.offset);
}

/** The DOM position a press at this point lands on, asked level with `el`'s lines when the point
 *  is inside it; the position may lie outside `el`. */
export function caretSeatInElement(
	el: HTMLElement,
	clientX: number,
	clientY: number
): { node: Node; offset: number } | null {
	return caretSeatFromPoint(el.ownerDocument, clientX, levelWithLines(el, clientX, clientY));
}

/** Whether a point inside `el`'s box lies above its first line or below its last, in the padding
 *  where Mac and Linux would place a press at that line's start or end. */
export function isInPaddingRow(el: HTMLElement, clientX: number, clientY: number): boolean {
	const box = el.getBoundingClientRect();
	if (!isInside(box, clientX, clientY)) return false;
	const band = linesBandOf(el, box);
	return band !== null && (clientY < band.top || clientY > band.bottom);
}

/** The browser's own hit test: `caretRangeFromPoint` on Chromium and WebKit,
 *  `caretPositionFromPoint` as the Firefox fallback. */
function caretSeatFromPoint(
	doc: Document,
	clientX: number,
	clientY: number
): { node: Node; offset: number } | null {
	const rangeFromPoint = (
		doc as Document & {
			caretRangeFromPoint?: (x: number, y: number) => Range | null;
		}
	).caretRangeFromPoint?.(clientX, clientY);
	if (rangeFromPoint) {
		return { node: rangeFromPoint.startContainer, offset: rangeFromPoint.startOffset };
	}
	const posFromPoint = (
		doc as Document & {
			caretPositionFromPoint?: (
				x: number,
				y: number
			) => { offsetNode: Node; offset: number } | null;
		}
	).caretPositionFromPoint?.(clientX, clientY);
	return posFromPoint ? { node: posFromPoint.offsetNode, offset: posFromPoint.offset } : null;
}

/** A point one pixel inside `rect`, so the topmost element there is the box's own content. */
export function clampPointIntoBox(rect: DOMRect, x: number, y: number): { x: number; y: number } {
	return {
		x: clamp(x, rect.left + 1, rect.right - 1),
		y: clamp(y, rect.top + 1, rect.bottom - 1)
	};
}

// Mac and Linux Chromium answer a point above the first line or below the last with that line's
// start or end, and Windows with the column; a point level with a line gets the column everywhere.
function levelWithLines(el: HTMLElement, x: number, y: number): number {
	const box = el.getBoundingClientRect();
	if (!isInside(box, x, y)) return y;
	const band = linesBandOf(el, box);
	return band ? clamp(y, band.top + 1, band.bottom - 1) : y;
}

function isInside(box: DOMRect, x: number, y: number): boolean {
	return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}

/** The rows between `el`'s top and bottom padding; null when they leave no row one pixel inside.
 *  Only rows: a hanging list marker sits in the left padding, and the browser keeps a column there. */
function linesBandOf(el: HTMLElement, box: DOMRect): { top: number; bottom: number } | null {
	const style = getComputedStyle(el);
	const px = (value: string) => parseFloat(value) || 0;
	// The client box leaves out the border and a classic scrollbar; an inline element has none.
	const inline = el.clientWidth === 0 && el.clientHeight === 0;
	const top = box.top + (inline ? px(style.borderTopWidth) : el.clientTop);
	const bottom = inline ? box.bottom - px(style.borderBottomWidth) : top + el.clientHeight;
	const band = { top: top + px(style.paddingTop), bottom: bottom - px(style.paddingBottom) };
	return band.bottom - band.top < 2 ? null : band;
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(Math.max(value, low), high);
}
