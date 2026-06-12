/**
 * Inline pipeline pre-pass: CommonMark §6.1 backslash escapes. Recognizes
 * `\X` where X is one of the 32 escapable ASCII punctuation characters.
 * Walks text gaps between occupied input nodes; the gaps are scanned, the
 * occupied nodes are passed through.
 */

import type { InlineNode } from '../nodes';
import { forEachGap, interleave, occupiedRangesFrom } from './ranges';

const ESCAPABLE = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~');

export function scanEscapes(
	raw: string,
	start: number,
	end: number,
	occupied: InlineNode[]
): InlineNode[] {
	const occupiedRanges = occupiedRangesFrom(occupied);

	const found: InlineNode[] = [];
	forEachGap(occupiedRanges, start, end, (s, e) => scanRegion(raw, s, e, found));

	return interleave(raw, start, end, occupied, found);
}

function scanRegion(raw: string, start: number, end: number, out: InlineNode[]): void {
	let pos = start;
	while (pos < end) {
		if (raw[pos] === '\\' && pos + 1 < end && ESCAPABLE.has(raw[pos + 1])) {
			out.push({ kind: 'escape', start: pos, end: pos + 2 });
			pos += 2;
		} else {
			pos++;
		}
	}
}
