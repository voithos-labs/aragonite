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

/** Widens an endpoint block's selected lines to its box's edges, a start rightward and down to its
 *  last line, an end leftward and up to its first; each line spans its line box, never the padding. */
export function reachLineEdges(
	lines: readonly LocalRect[],
	side: 'start' | 'end',
	width: number,
	height: number,
	lineHeight: number
): LocalRect[] {
	if (lines.length === 0) return [];
	const right = lines.reduce((edge, line) => Math.max(edge, line.left + line.width), width);
	const first = lineBox(lines[0], lineHeight, height);
	const last = lineBox(lines[lines.length - 1], lineHeight, height);
	if (side === 'start') {
		const left = lines[0].left;
		const startLine = {
			left,
			top: first.top,
			width: right - left,
			height: first.bottom - first.top
		};
		return lines.length === 1
			? [startLine]
			: [
					startLine,
					{ left: 0, top: first.bottom, width: right, height: last.bottom - first.bottom }
				];
	}
	const end = lines[lines.length - 1];
	const endLine = {
		left: 0,
		top: last.top,
		width: end.left + end.width,
		height: last.bottom - last.top
	};
	return lines.length === 1
		? [endLine]
		: [{ left: 0, top: first.top, width: right, height: last.top - first.top }, endLine];
}

/** The vertical span of `line`'s line box: its glyphs plus the leading `lineHeight` adds, split
 *  evenly above and below, kept inside the block. */
function lineBox(
	line: LocalRect,
	lineHeight: number,
	height: number
): { top: number; bottom: number } {
	const leading = lineHeight > line.height ? (lineHeight - line.height) / 2 : 0;
	return {
		top: Math.max(0, line.top - leading),
		bottom: Math.min(height, line.top + line.height + leading)
	};
}

/** A vertical stretch of the page, in pixels. */
export interface Band {
	top: number;
	bottom: number;
}

/** The stretches between the first band and the last that no band covers: the space between two
 *  blocks a range runs through, which paints too so the range reads as one region. */
export function holesBetween(bands: readonly Band[]): Band[] {
	const sorted = [...bands].sort((a, b) => a.top - b.top);
	const holes: Band[] = [];
	let bottom = sorted.length > 0 ? sorted[0].bottom : 0;
	for (const band of sorted.slice(1)) {
		if (band.top > bottom) holes.push({ top: bottom, bottom: band.top });
		bottom = Math.max(bottom, band.bottom);
	}
	return holes;
}
