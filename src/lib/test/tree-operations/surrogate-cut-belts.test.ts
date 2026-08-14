// The two byte sinks that cut at a caret offset: the split's line-ending cut and the single-block
// range cut. Miss-analysis: every offset these sinks are driven with in the suite comes from a
// hand-written ASCII fixture, so an offset splitting a surrogate pair reaches them only from a
// real caret nobody simulates (#167, and #105's split arm).
import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { snapToScalarBoundary } from '../../core/lines';
import { splitNode, cutRangeFromDisplay } from '../../tree-operations/node-ops';
import { createSharingState } from '../../tree-operations/sharing';
import type { NodeView } from '../../core/node-views';

const BOY = 'a\u{1F466}b\n';

/** True when every surrogate in `text` has its partner. */
function isWellFormed(text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		const isHigh = code >= 0xd800 && code <= 0xdbff;
		const isLow = code >= 0xdc00 && code <= 0xdfff;
		if (isHigh && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
			i++;
			continue;
		}
		if (isHigh || isLow) return false;
	}
	return true;
}

describe('snapToScalarBoundary', () => {
	it('moves an interior offset back to the pair start and leaves every other alone', () => {
		expect(snapToScalarBoundary(BOY, 2)).toBe(1);
		for (const offset of [0, 1, 3, 4]) expect(snapToScalarBoundary(BOY, offset)).toBe(offset);
	});

	it('is identity where no pair is involved', () => {
		expect(snapToScalarBoundary('plain\n', 3)).toBe(3);
		// A lone high surrogate already in the bytes is not a pair to protect.
		expect(snapToScalarBoundary('a\uD83Db', 2)).toBe(2);
	});
});

describe('the split cut', () => {
	it('splits beside the pair, never through it', () => {
		const doc = parse(BOY);
		splitNode(doc, 0, 2, createSharingState(), undefined, undefined);
		const out = serialize(doc);
		expect(isWellFormed(out)).toBe(true);
		expect(out).toBe('a\n\n\u{1F466}b\n');
	});
});

describe('the single-block range cut', () => {
	it('cuts to the pair boundary, leaving no half behind', () => {
		const node = parse(BOY).children[0] as NodeView;
		const cut = cutRangeFromDisplay(
			node,
			'a\u{1F466}b',
			{ start: 0, end: 2 },
			undefined,
			undefined
		);
		expect(isWellFormed(cut.display)).toBe(true);
		expect(cut.display).toBe('\u{1F466}b');
	});

	it('snaps the start endpoint too', () => {
		const node = parse(BOY).children[0] as NodeView;
		const cut = cutRangeFromDisplay(
			node,
			'a\u{1F466}b',
			{ start: 2, end: 4 },
			undefined,
			undefined
		);
		expect(isWellFormed(cut.display)).toBe(true);
		expect(cut.display).toBe('a');
	});
});
