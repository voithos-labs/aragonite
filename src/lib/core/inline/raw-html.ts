/**
 * Inline pipeline stage: claim CommonMark §6.10 raw HTML ranges. Runs after
 * links/autolinks (autolinks win for `<url>`/`<email>`) and before emphasis
 * (so `*` inside an HTML attribute can't pair as a delimiter run).
 */

import type { InlineNode } from '../nodes';
import { matchHtmlFormAt } from './html-tag-grammar';

type Range = { start: number; end: number };

export function scanInlineRawHtml(
	raw: string,
	start: number,
	end: number,
	occupied: InlineNode[]
): InlineNode[] {
	const occupiedRanges: Range[] = occupied
		.filter((n) => n.kind !== 'text')
		.map((n) => ({ start: n.start, end: n.end }));

	const found: InlineNode[] = [];
	let pos = start;

	while (pos < end) {
		const skip = occupiedEndAt(occupiedRanges, pos);
		if (skip !== null) {
			pos = skip;
			continue;
		}
		if (raw[pos] !== '<') {
			pos++;
			continue;
		}
		const m = matchHtmlFormAt(raw, pos, end);
		if (m === null) {
			pos++;
			continue;
		}
		const matchEnd = pos + m.length;
		if (overlapsOccupied(occupiedRanges, pos, matchEnd)) {
			pos++;
			continue;
		}
		found.push({ kind: 'rawHtml', start: pos, end: matchEnd });
		pos = matchEnd;
	}

	if (found.length === 0) return occupied;

	const allOccupied: InlineNode[] = [...occupied.filter((n) => n.kind !== 'text'), ...found].sort(
		(a, b) => a.start - b.start
	);

	const result: InlineNode[] = [];
	let cursor = start;
	for (const node of allOccupied) {
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

function occupiedEndAt(occupied: Range[], pos: number): number | null {
	for (const range of occupied) {
		if (pos >= range.end) continue;
		if (pos < range.start) return null;
		return range.end;
	}
	return null;
}

function overlapsOccupied(occupied: Range[], start: number, end: number): boolean {
	for (const range of occupied) {
		if (range.end <= start) continue;
		if (range.start >= end) break;
		return true;
	}
	return false;
}
