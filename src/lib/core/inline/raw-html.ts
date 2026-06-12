/**
 * Inline pipeline stage: claim CommonMark §6.10 raw HTML ranges. Runs after
 * links/autolinks (autolinks win for `<url>`/`<email>`) and before emphasis
 * (so `*` inside an HTML attribute can't pair as a delimiter run).
 */

import type { InlineNode } from '../nodes';
import { matchHtmlFormAt } from './html-tag-grammar';
import { interleave, occupiedEndAt, occupiedRangesFrom, overlapsOccupied } from './ranges';

export function scanInlineRawHtml(
	raw: string,
	start: number,
	end: number,
	occupied: InlineNode[]
): InlineNode[] {
	const occupiedRanges = occupiedRangesFrom(occupied);

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

	return interleave(raw, start, end, occupied, found);
}
