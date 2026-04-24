/**
 * DOMRect helpers for partial-selection overlay paint. Produces the
 * client rects a block contributes when it is an endpoint of a
 * cross-block selection.
 */

import { createRangeFromOffsets } from './cursor-utils';

/**
 * Client rects covering [startOffset, endOffset) within `el`. The jsdom
 * guard on `getClientRects` keeps unit tests from crashing (real pixel
 * geometry is covered by e2e).
 */
export function measurePartialRectsInContentEditable(
	el: HTMLElement,
	startOffset: number,
	endOffset: number
): DOMRect[] {
	if (startOffset === endOffset) return [];
	const range = createRangeFromOffsets(el, startOffset, endOffset);
	if (!range || typeof range.getClientRects !== 'function') return [];
	return Array.from(range.getClientRects());
}
