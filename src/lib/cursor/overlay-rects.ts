/** The client rects a block contributes when it is an endpoint of a cross-block selection. */

import type { DomTextOffset } from './coordinate-spaces';
import { createRangeAtDomTextOffsets, widgetsIntersectingRange } from './widget-offset';

/** Client rects covering the DOM-walk range [startOffset, endOffset) within `el`. The
 *  `getClientRects` check keeps jsdom unit tests from crashing. */
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

/** A rect in a block's own pixels, from the block box's top-left corner. */
export interface LocalRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** One rect per line, in top order. Merges vertically overlapping rects, not just equal tops, so
 *  a tall inline widget beside text is not highlighted twice. */
export function mergeRectsPerLine(rects: readonly LocalRect[]): LocalRect[] {
	if (rects.length <= 1) return rects.slice();
	const sorted = [...rects].sort((a, b) => a.top - b.top);
	const merged: LocalRect[] = [];
	let current = { ...sorted[0] };

	for (let i = 1; i < sorted.length; i++) {
		const r = sorted[i];
		const overlap =
			Math.min(current.top + current.height, r.top + r.height) - Math.max(current.top, r.top);
		if (overlap > Math.min(current.height, r.height) * 0.5) {
			const left = Math.min(current.left, r.left);
			const right = Math.max(current.left + current.width, r.left + r.width);
			const top = Math.min(current.top, r.top);
			const bottom = Math.max(current.top + current.height, r.top + r.height);
			current = { left, top, width: right - left, height: bottom - top };
		} else {
			merged.push(current);
			current = { ...r };
		}
	}
	merged.push(current);
	return merged;
}

/** Widens an endpoint block's selected lines to its box's edges: a start runs to the right edge
 *  and takes every line below, an end takes every line above and runs from the left edge. */
export function reachLineEdges(
	lines: readonly LocalRect[],
	side: 'start' | 'end',
	width: number,
	height: number
): LocalRect[] {
	if (lines.length === 0) return [];
	const right = lines.reduce((edge, line) => Math.max(edge, line.left + line.width), width);
	if (side === 'start') {
		const first = lines[0];
		const below = first.top + first.height;
		const firstLine = {
			left: first.left,
			top: first.top,
			width: right - first.left,
			height: first.height
		};
		return height > below
			? [firstLine, { left: 0, top: below, width: right, height: height - below }]
			: [firstLine];
	}
	const last = lines[lines.length - 1];
	const lastLine = { left: 0, top: last.top, width: last.left + last.width, height: last.height };
	return last.top > 0
		? [{ left: 0, top: 0, width: right, height: last.top }, lastLine]
		: [lastLine];
}
