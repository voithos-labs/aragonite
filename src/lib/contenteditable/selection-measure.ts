/**
 * Shared partial-rect measurement for contenteditable surfaces.
 * Used by TextEditableBlock and CodeBlock's `measurePartialRects?`
 * implementations when the block is an endpoint of a cross-block selection.
 *
 * Takes a contenteditable element plus two character offsets into its
 * visible text and returns the DOMRect list covering the range. Callers
 * convert to wrapper-local coordinates for positioning overlays.
 */

import { createRangeFromOffsets } from './cursor-utils';

/**
 * Return the client rects covering the range [startOffset, endOffset)
 * within `el`. Zero-length ranges return an empty array. Out-of-range
 * offsets are clamped by the underlying `createRangeFromOffsets` helper.
 *
 * jsdom's Range does not implement getClientRects; guard against that so
 * unit tests exercising boundary behavior don't crash. Real pixel
 * geometry is covered by the cross-block selection e2e specs.
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
