/**
 * Inline pipeline pre-pass: CommonMark §6.1 backslash escapes. Recognizes
 * `\X` where X is one of the 32 escapable ASCII punctuation characters.
 * Walks text gaps between occupied input nodes; the gaps are scanned, the
 * occupied nodes are passed through.
 */

import type { InlineNode } from '../nodes';

const ESCAPABLE = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~');

export function scanEscapes(
	raw: string,
	start: number,
	end: number,
	occupied: InlineNode[]
): InlineNode[] {
	const occupiedRanges: Array<{ start: number; end: number }> = occupied
		.filter((n) => n.kind !== 'text')
		.map((n) => ({ start: n.start, end: n.end }));

	const found: InlineNode[] = [];
	let pos = start;
	for (const range of occupiedRanges) {
		scanRegion(raw, pos, range.start, found);
		pos = range.end;
	}
	scanRegion(raw, pos, end, found);

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

function interleave(
	raw: string,
	start: number,
	end: number,
	occupied: InlineNode[],
	found: InlineNode[]
): InlineNode[] {
	const all: InlineNode[] = [
		...occupied.filter((n) => n.kind !== 'text'),
		...found
	].sort((a, b) => a.start - b.start);

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
		result.push({
			kind: 'text',
			start: cursor,
			end,
			text: raw.slice(cursor, end)
		});
	}
	return result;
}
