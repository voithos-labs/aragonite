/**
 * CommonMark §2.5 entity and numeric character references. Three forms —
 * named (`&copy;`), decimal (`&#NNN;`), hex (`&#xNNNN;` or `&#XNNNN;`).
 *
 * Per spec, code points that are zero, exceed 0x10FFFF, or fall in the
 * surrogate range 0xD800–0xDFFF decode to U+FFFD (replacement character).
 */

import type { InlineNode } from '../nodes';
import { HTML5_NAMED_ENTITIES } from './html-entities';

const REPLACEMENT = '�';

// Longest reference body that can possibly decode: the longest named entity
// is 31 chars (`CounterClockwiseContourIntegral`); numeric forms are at most
// 8. Capping the `;` search here keeps `&`-floods linear — an unbounded
// indexOf rescans to the end of the region per candidate.
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
	// C1 range (0x80–0x9F, e.g. `&#128;`) decodes verbatim, no cp1252 remap: if a
	// corpus widening ever spells one, a divergence from an HTML5 reference is
	// deliberate — we follow CommonMark §2.5's letter (probe-verified spec-correct).
	return String.fromCodePoint(codePoint);
}
