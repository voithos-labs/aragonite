/**
 * CommonMark §2.5 entity and numeric character references: named (`&copy;`), decimal, hex.
 * Per spec, zero, out-of-range, and surrogate code points decode to U+FFFD.
 */

import type { InlineNode } from '../nodes';
import { HTML5_NAMED_ENTITIES } from './html-entities';

const REPLACEMENT = '�';

// The longest body that can decode (`CounterClockwiseContourIntegral`). Capping the `;` search
// keeps `&`-floods linear, where an unbounded indexOf rescans the region per candidate.
const MAX_REFERENCE_BODY = 31;

/** Match one character reference; `pos` must point at an `&`. */
export function matchCharacterReference(raw: string, pos: number, end: number): InlineNode | null {
	const searchEnd = Math.min(end, pos + MAX_REFERENCE_BODY + 2);
	let semi = -1;
	for (let i = pos + 1; i < searchEnd; i++) {
		if (raw[i] === ';') {
			semi = i;
			break;
		}
	}
	if (semi === -1) return null;
	const body = raw.slice(pos + 1, semi);
	if (body.length === 0) return null;

	let decoded: string | null;
	if (body[0] === '#') {
		decoded = decodeNumeric(body);
	} else {
		decoded = Object.hasOwn(HTML5_NAMED_ENTITIES, body) ? HTML5_NAMED_ENTITIES[body] : null;
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
	// The C1 range decodes verbatim, no cp1252 remap: a divergence from an HTML5 reference here
	// is deliberate, following CommonMark §2.5's letter.
	return String.fromCodePoint(codePoint);
}
