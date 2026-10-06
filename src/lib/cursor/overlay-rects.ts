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

/** A painted rect by its four edges; `endpoint` marks a range end's own line paint. */
export interface PaintedRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
	endpoint?: boolean;
}

/** The rects that make a cross-block range one region: every line between its first and last spans
 *  `left` to `right`, leaving bare only the text before the start point and after the end point. */
export function regionGaps(
	painted: readonly PaintedRect[],
	left: number,
	right: number
): PaintedRect[] {
	if (painted.length === 0) return [];
	const first = painted.reduce((a, b) => (b.top < a.top ? b : a));
	const last = painted.reduce((a, b) => (b.bottom > a.bottom ? b : a));
	const ys = [...new Set(painted.flatMap((r) => [r.top, r.bottom]))].sort((a, b) => a - b);
	const gaps: PaintedRect[] = [];
	for (let i = 0; i + 1 < ys.length; i++) {
		const top = ys[i];
		const bottom = ys[i + 1];
		const from = first.endpoint && bottom <= first.bottom ? first.left : left;
		const to = last.endpoint && top >= last.top ? last.right : right;
		const covering = painted
			.filter((r) => r.top <= top && r.bottom >= bottom)
			.sort((a, b) => a.left - b.left);
		let x = from;
		for (const r of covering) {
			if (Math.min(r.left, to) > x)
				gaps.push({ left: x, top, right: Math.min(r.left, to), bottom });
			x = Math.max(x, r.right);
		}
		if (to > x) gaps.push({ left: x, top, right: to, bottom });
	}
	return stackRuns(gaps);
}

// Joins gaps of one width that meet top to bottom, so a tall gap is one element, not one per edge.
function stackRuns(gaps: PaintedRect[]): PaintedRect[] {
	const sorted = [...gaps].sort((a, b) => a.left - b.left || a.right - b.right || a.top - b.top);
	const runs: PaintedRect[] = [];
	for (const gap of sorted) {
		const run = runs[runs.length - 1];
		if (run && run.left === gap.left && run.right === gap.right && run.bottom === gap.top) {
			run.bottom = gap.bottom;
		} else runs.push({ ...gap });
	}
	return runs.sort((a, b) => a.top - b.top || a.left - b.left);
}
