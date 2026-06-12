/**
 * Range coordination shared by the gap-scanning inline stages: collect spans
 * prior stages claimed, scan only the gaps between them, and re-emit a flat
 * node list with text synthesized for what remains uncovered. All helpers
 * assume ranges sorted by start (stage inputs are; interleave re-sorts).
 */
import type { InlineNode } from '../nodes';

export interface Range {
	start: number;
	end: number;
}

/** Spans already claimed by prior stages (every non-text node). */
export function occupiedRangesFrom(occupied: InlineNode[]): Range[] {
	return occupied.filter((n) => n.kind !== 'text').map((n) => ({ start: n.start, end: n.end }));
}

/** Invoke `scan` over each unoccupied gap of [start, end), in order. */
export function forEachGap(
	ranges: Range[],
	start: number,
	end: number,
	scan: (gapStart: number, gapEnd: number) => void
): void {
	let pos = start;
	for (const range of ranges) {
		scan(pos, range.start);
		pos = range.end;
	}
	scan(pos, end);
}

/** End of the occupied range covering `pos`, or null if `pos` is free. */
export function occupiedEndAt(occupied: Range[], pos: number): number | null {
	for (const range of occupied) {
		if (pos >= range.end) continue;
		if (pos < range.start) return null;
		return range.end;
	}
	return null;
}

/** Whether [start, end) overlaps any occupied range. */
export function overlapsOccupied(occupied: Range[], start: number, end: number): boolean {
	for (const range of occupied) {
		if (range.end <= start) continue;
		if (range.start >= end) break;
		return true;
	}
	return false;
}

/** Whether `inner` is fully contained in any of `outers`. */
export function isContainedInAny(inner: Range, outers: Range[]): boolean {
	for (const outer of outers) {
		if (inner.start >= outer.start && inner.end <= outer.end) return true;
	}
	return false;
}

/** Merge found nodes into occupied, synthesizing text nodes for the gaps. */
export function interleave(
	raw: string,
	start: number,
	end: number,
	occupied: InlineNode[],
	found: InlineNode[]
): InlineNode[] {
	const all: InlineNode[] = [...occupied.filter((n) => n.kind !== 'text'), ...found].sort(
		(a, b) => a.start - b.start
	);

	const result: InlineNode[] = [];
	let cursor = start;
	for (const node of all) {
		if (cursor < node.start) {
			result.push({
				kind: 'text',
				start: cursor,
				end: node.start,
				text: raw.slice(cursor, node.start)
			});
		}
		result.push(node);
		cursor = node.end;
	}
	if (cursor < end) {
		result.push({ kind: 'text', start: cursor, end, text: raw.slice(cursor, end) });
	}
	return result;
}
