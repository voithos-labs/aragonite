/** The client rects a block contributes when it is an endpoint of a cross-block selection. */

import type { DomTextOffset } from './coordinate-spaces';
import { createRangeAtDomTextOffsets, widgetsIntersectingRange } from './widget-offset';

/**
 * Client rects covering the walk-space range [startOffset, endOffset) within `el` (see
 * `cursor/widget-offset.ts`). The `getClientRects` guard keeps jsdom unit tests from
 * crashing; real pixel geometry is covered by e2e.
 */
export function measurePartialRectsInContentEditable(
	el: HTMLElement,
	startOffset: DomTextOffset,
	endOffset: DomTextOffset
): DOMRect[] {
	if (startOffset === endOffset) return [];
	const range = createRangeAtDomTextOffsets(el, startOffset, endOffset);
	const rects: DOMRect[] =
		range && typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : [];
	// An atomic widget adds 0 chars to textContent, so a range inside one emits no text
	// rect; its bounding box is what keeps the highlight visible over it.
	for (const widget of widgetsIntersectingRange(el, startOffset, endOffset)) {
		rects.push(widget.getBoundingClientRect());
	}
	return rects;
}
