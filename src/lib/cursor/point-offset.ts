/**
 * Viewport point to caret offset inside one element. The browser finds the DOM position, and
 * `widget-offset.ts`'s walk does the arithmetic: this module computes no offset of its own, so
 * an atomic widget and a leading marker prefix count here exactly as they do for a live caret read.
 */

import { rawOffsetAt } from './widget-offset';

/** The caret offset in `el` nearest a viewport point, clamped first into `el`'s box and level with
 *  its lines, so a click on the frame still names one. Null where `el` holds no text. */
export function caretOffsetAtPoint(
	el: HTMLElement,
	clientX: number,
	clientY: number
): number | null {
	const probe = clampPointIntoBox(linesBandOf(el), clientX, clientY);
	return offsetFromViewportPoint(el, probe.x, probe.y);
}

/**
 * The exact counterpart: null for a point outside `el`, which a hit test must decline rather
 * than round into the nearest offset.
 */
export function offsetFromViewportPoint(
	blockEl: HTMLElement,
	clientX: number,
	clientY: number
): number | null {
	const seat = caretSeatFromPoint(blockEl.ownerDocument, clientX, clientY);
	if (!seat || !blockEl.contains(seat.node)) return null;
	return rawOffsetAt(blockEl, seat.node, seat.offset);
}

/** The DOM position a caret placed at this point would take, from the browser's own hit test:
 *  `caretRangeFromPoint` on Chromium and WebKit, `caretPositionFromPoint` as the Firefox fallback. */
export function caretSeatFromPoint(
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
function linesBandOf(el: HTMLElement): DOMRect {
	const box = el.getBoundingClientRect();
	const style = getComputedStyle(el);
	const px = (value: string) => parseFloat(value) || 0;
	// The client box leaves out the border and a classic scrollbar; an inline element has none.
	const inline = el.clientWidth === 0 && el.clientHeight === 0;
	const top = box.top + (inline ? px(style.borderTopWidth) : el.clientTop);
	const bottom = inline ? box.bottom - px(style.borderBottomWidth) : top + el.clientHeight;
	const band = { top: top + px(style.paddingTop), bottom: bottom - px(style.paddingBottom) };
	// Under two pixels there is no row one pixel inside, so the border box serves.
	if (band.bottom - band.top < 2) return box;
	// Across, the border box stays: a hanging list marker sits in the left padding.
	return new DOMRect(box.left, band.top, box.width, band.bottom - band.top);
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(Math.max(value, low), high);
}
