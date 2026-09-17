/**
 * Viewport point → caret offset inside one element. The probe is the browser's, the arithmetic
 * is `widget-offset.ts`'s walk: this module mints no offset of its own, so an atomic widget and
 * a leading ambient marker count here exactly as they do for a live caret read.
 */

import { ambientLengthOf } from '../ambient/ambient-dom';
import { toClampedRawOffset } from './coordinate-spaces';
import { domTextOffsetAtNode } from './widget-offset';

/**
 * The caret offset in `el` NEAREST a viewport point: the point clamps into `el`'s box first, so a
 * press on chrome above or beside the text still names one. What `caretTargetAtPoint` owes, since
 * a caret-placing gesture must land. Null where the element holds no text position at all.
 */
export function caretOffsetAtPoint(
	el: HTMLElement,
	clientX: number,
	clientY: number
): number | null {
	const probe = clampPointIntoBox(el.getBoundingClientRect(), clientX, clientY);
	return offsetFromViewportPoint(el, probe.x, probe.y);
}

/**
 * The EXACT twin: null for a point outside `el`, which a hit test must decline rather than
 * round into the nearest offset.
 */
export function offsetFromViewportPoint(
	blockEl: HTMLElement,
	clientX: number,
	clientY: number
): number | null {
	const seat = caretSeatFromPoint(blockEl.ownerDocument, clientX, clientY);
	if (!seat || !blockEl.contains(seat.node)) return null;
	const content = domTextOffsetAtNode(blockEl, seat.node, seat.offset);
	return toClampedRawOffset(content, ambientLengthOf(blockEl));
}

/**
 * The DOM position a caret placed at this point takes — the browser's own hit test, so the
 * seat a press is about to make can be read before it lands. `caretRangeFromPoint` is
 * Chromium/WebKit (all Tauri webviews); `caretPositionFromPoint` the Firefox-style fallback.
 */
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

function clamp(value: number, low: number, high: number): number {
	return Math.min(Math.max(value, low), high);
}
