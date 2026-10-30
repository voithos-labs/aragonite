/**
 * Which marks take the click, where a hover mark's hit area reaches, and which of several marks
 * answers: one precedence rule for the overlay's stacking, the hover hit-test and the keyboard's
 * activate command, so the pointer and the keyboard pick the same mark.
 */

import type { LocalRect } from '../core/coordinate-spaces';
import type { IndexedDecoration } from './buckets';
import type { MarkDecoration } from './types';

/** Only a click handler takes the pointer; a hover-only mark lets it through to the text. */
export function takesPointer(dec: MarkDecoration): boolean {
	return !!dec.interactive?.onClick;
}

/** Negative when `a` wins: the shorter range, then the earlier entry in the merged list, which
 *  is the earlier-registered source and then the earlier mark in its answer. */
export function comparePrecedence(
	a: IndexedDecoration<MarkDecoration>,
	b: IndexedDecoration<MarkDecoration>
): number {
	return a.dec.end - a.dec.start - (b.dec.end - b.dec.start) || a.index - b.index;
}

/** The winning mark among those `has` accepts, or undefined when it accepts none. */
export function winningMark(
	marks: readonly IndexedDecoration<MarkDecoration>[],
	has: (dec: MarkDecoration) => boolean
): IndexedDecoration<MarkDecoration> | undefined {
	let best: IndexedDecoration<MarkDecoration> | undefined;
	for (const mark of marks) {
		if (has(mark.dec) && (!best || comparePrecedence(mark, best) < 0)) best = mark;
	}
	return best;
}

/** Plain marks in their own order, then the click marks with the winner last, so a click on an
 *  overlap lands on the mark the precedence rule names. */
export function paintOrder(
	marks: readonly IndexedDecoration<MarkDecoration>[]
): IndexedDecoration<MarkDecoration>[] {
	const plain = marks.filter((m) => !takesPointer(m.dec));
	const pointer = marks.filter((m) => takesPointer(m.dec));
	return [...plain, ...pointer.sort((a, b) => comparePrecedence(b, a))];
}

/** The two measurements a block offers for painting marks: a leaf's range rects, a grid's cells. */
export interface MarkMeasurer {
	measurePartialRects?(start: number, end: number): DOMRect[];
	cellRect?(rowIdx: number, colIdx: number): DOMRect | null;
}

/** The viewport rects a mark paints: one per visual line in a prose block, one whole cell in a
 *  grid, the way the overlay paints them. */
export function paintedMarkRects(
	dec: MarkDecoration,
	componentAt: (path: number[]) => MarkMeasurer | null
): DOMRect[] {
	// A grid's cell marks paint whole cells, though a cell has measurable text of its own.
	const grid = dec.path.length > 2 ? componentAt(dec.path.slice(0, -2)) : null;
	if (grid?.cellRect) {
		const cell = grid.cellRect(dec.path[dec.path.length - 2], dec.path[dec.path.length - 1]);
		return cell ? [cell] : [];
	}
	const leaf = componentAt(dec.path);
	return leaf ? leafMarkRects(leaf, dec) : [];
}

/** A collapsed range still yields a zero-width rect at a line boundary, an invisible sliver. */
export function leafMarkRects(leaf: MarkMeasurer, dec: MarkDecoration): DOMRect[] {
	return (leaf.measurePartialRects?.(dec.start, dec.end) ?? []).filter((r) => r.width > 0);
}

/** The rect the point falls on, or null; a point between two consecutive lines of the mark
 *  counts on the rect above or below spanning it, so crossing lines never leaves the mark. */
export function hitRect(rects: readonly LocalRect[], x: number, y: number): LocalRect | null {
	const spansX = (r: LocalRect) => r.left <= x && x <= r.left + r.width;
	const direct = rects.find((r) => spansX(r) && r.top <= y && y <= r.top + r.height);
	if (direct) return direct;
	const bands: { top: number; bottom: number; rects: LocalRect[] }[] = [];
	for (const r of [...rects].sort((a, b) => a.top - b.top)) {
		const last = bands.at(-1);
		if (last && r.top < last.bottom) {
			last.bottom = Math.max(last.bottom, r.top + r.height);
			last.rects.push(r);
		} else bands.push({ top: r.top, bottom: r.top + r.height, rects: [r] });
	}
	for (let i = 0; i + 1 < bands.length; i++) {
		if (y <= bands[i].bottom || y >= bands[i + 1].top) continue;
		return bands[i].rects.find(spansX) ?? bands[i + 1].rects.find(spansX) ?? null;
	}
	return null;
}
