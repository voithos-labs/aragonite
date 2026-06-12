/**
 * Inline pipeline pre-pass: CommonMark §6.2 entity and numeric character
 * references. Three forms — named (`&copy;`), decimal (`&#NNN;`), hex
 * (`&#xNNNN;` or `&#XNNNN;`). Walks text gaps between occupied input nodes.
 *
 * Per spec, code points that are zero, exceed 0x10FFFF, or fall in the
 * surrogate range 0xD800–0xDFFF decode to U+FFFD (replacement character).
 */

import type { InlineNode } from '../nodes';
import { HTML5_NAMED_ENTITIES } from './html-entities';
import { forEachGap, interleave, occupiedRangesFrom } from './ranges';

const REPLACEMENT = '�';

export function scanCharacterReferences(
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
		if (raw[pos] === '&') {
			const ref = tryMatchReference(raw, pos, end);
			if (ref !== null) {
				out.push(ref);
				pos = ref.end;
				continue;
			}
		}
		pos++;
	}
}

function tryMatchReference(raw: string, pos: number, end: number): InlineNode | null {
	const semi = raw.indexOf(';', pos + 1);
	if (semi === -1 || semi >= end) return null;
	const body = raw.slice(pos + 1, semi);
	if (body.length === 0) return null;

	let decoded: string | null;
	if (body[0] === '#') {
		decoded = decodeNumeric(body);
	} else {
		decoded = HTML5_NAMED_ENTITIES[body] ?? null;
	}
	if (decoded === null) return null;

	return {
		kind: 'entityReference',
		start: pos,
		end: semi + 1,
		decoded
	};
}

function decodeNumeric(body: string): string | null {
	if (body.length < 2) return null;
	const isHex = body[1] === 'x' || body[1] === 'X';
	const digits = body.slice(isHex ? 2 : 1);
	if (digits.length === 0) return null;

	if (isHex) {
		if (digits.length > 6) return null;
		if (!/^[0-9A-Fa-f]+$/.test(digits)) return null;
	} else {
		if (digits.length > 7) return null;
		if (!/^[0-9]+$/.test(digits)) return null;
	}

	const codePoint = parseInt(digits, isHex ? 16 : 10);
	if (codePoint === 0) return REPLACEMENT;
	if (codePoint > 0x10ffff) return REPLACEMENT;
	if (codePoint >= 0xd800 && codePoint <= 0xdfff) return REPLACEMENT;
	return String.fromCodePoint(codePoint);
}
