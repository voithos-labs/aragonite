/**
 * DOMRect helpers for partial-selection overlay paint. Produces the
 * client rects a block contributes when it is an endpoint of a
 * cross-block selection.
 */

import { createRangeAtRawOffsets, widgetsIntersectingRange } from './widget-offset';

/**
 * Client rects covering [startOffset, endOffset) within `el`. Offsets are
 * raw-content positions (text-node lengths plus image-widget raw lengths
 * via `cursor/widget-offset.ts`); for widget-free blocks this is identical
 * to textContent offsets. The jsdom guard on `getClientRects` keeps unit
 * tests from crashing (real pixel geometry is covered by e2e).
 */
export function measurePartialRectsInContentEditable(
	el: HTMLElement,
	startOffset: number,
	endOffset: number
): DOMRect[] {
	if (startOffset === endOffset) return [];
	const range = createRangeAtRawOffsets(el, startOffset, endOffset);
	const rects: DOMRect[] =
		range && typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : [];
	// Atomic inline widgets add 0 chars to textContent, so a range entirely inside
	// one collapses to zero width and emits no text rect. Cover each intersected
	// widget with its bounding box so the highlight/selection stays visible over it.
	for (const widget of widgetsIntersectingRange(el, startOffset, endOffset)) {
		rects.push(widget.getBoundingClientRect());
	}
	return rects;
}
