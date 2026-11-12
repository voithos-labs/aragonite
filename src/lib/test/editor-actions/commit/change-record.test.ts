// A draft's range mapped through what one write changed: moved past text written before it, kept
// clear of text written at its edges, and refused when text may have gone inside it.
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { fixtureGrammar } from '#lib/test/harness/fixture-grammar.js';
import {
	blockRange,
	byteAt,
	captureChange,
	changeAfter,
	pairsStay,
	partLengths,
	positionAt,
	rangeThrough,
	type PartRange
} from '#lib/editor-actions/commit/change-record.js';

/** The change from `before` to `after`, with the keystroke's typed text ending at `typedEnd` (a
 *  block and an offset into it), and `[from, to)` of `before` as a part range. */
function through(
	before: string,
	after: string,
	[from, to]: [number, number],
	typedEnd: { block: number; offset: number } | null = null
): [number, number] | null {
	const was = parse(before);
	const capture = captureChange(was, null);
	const now = parse(after);
	const change = changeAfter(now, capture, typedEnd)!;
	const lengths = partLengths(was);
	const range: PartRange = { from: positionAt(lengths, from), to: positionAt(lengths, to) };
	const moved = rangeThrough(range, change);
	const after_ = partLengths(now);
	return moved && [byteAt(after_, moved.from), byteAt(after_, moved.to)];
}

describe('a range through a write', () => {
	it('moves past text written before it and stays put before text written after it', () => {
		expect(through('one\n\ntwo\n', 'one!\n\ntwo\n', [5, 8])).toEqual([6, 9]);
		expect(through('one\n\ntwo\n', 'one\n\ntwo!\n', [0, 3])).toEqual([0, 3]);
	});

	it('is refused by text written inside it', () => {
		expect(through('one\n\ntwo\n', 'one\n\ntXwo\n', [5, 8])).toBeNull();
	});

	it('keeps text written at its start or its end outside it', () => {
		expect(through('one two\n', 'one Xtwo\n', [4, 7], { block: 0, offset: 5 })).toEqual([5, 8]);
		expect(through('one two\n', 'one twoX\n', [4, 7], { block: 0, offset: 8 })).toEqual([4, 7]);
	});

	it('moves to the block that holds it when a block is written above', () => {
		expect(through('one\n\ntwo\n', 'zero\n\none\n\ntwo\n', [5, 8])).toEqual([11, 14]);
	});

	// Miss-analysis: every mapping row typed a letter unlike its neighbours, where a diff can't tell
	// typing inside a range's last letters from typing just past them.
	it('is refused by a write that may have gone inside it when no caret says where', () => {
		expect(through('@que\n', '@quee\n', [0, 4])).toBeNull();
	});

	// Miss-analysis: a keystroke named only its own block, and the always-on record caught a broken
	// fence opener re-pairing the blocks below.
	it('names every block for a keystroke that opens, closes or moves a fence', () => {
		expect(pairsStay('```js\ncode\n```\n', '```js\ncodes\n```\n', fixtureGrammar)).toBe(true);
		expect(pairsStay('```js\ncode\n```\n', '``js\ncode\n```\n', fixtureGrammar)).toBe(false);
		expect(pairsStay('para\n', 'para\n```\n', fixtureGrammar)).toBe(false);
		expect(pairsStay('one\n', 'one!\n', fixtureGrammar)).toBe(true);
	});

	it('follows a keystroke caret to where its typed text went', () => {
		expect(through('@que\n', '@quee\n', [0, 4], { block: 0, offset: 4 })).toBeNull();
		expect(through('@que\n', '@quee\n', [0, 4], { block: 0, offset: 5 })).toEqual([0, 4]);
	});
});

// Miss-analysis: every block draft opened on a top-level block, or in a container no blank line
// stood above, so that line counted twice in a nested block's range went unseen.
describe("a block's range", () => {
	const source = 'one\n\n> two\n>\n> three\n\nfour\n';
	const doc = parse(source);
	const bytes = (path: number[]) => {
		const lengths = partLengths(doc);
		const range = blockRange(doc, path)!;
		return source.slice(byteAt(lengths, range.from), byteAt(lengths, range.to));
	};

	it('holds its own bytes, under a container that a blank line stands above too', () => {
		expect(bytes([1])).toBe('> two\n>\n> three\n');
		expect(bytes([1, 0])).toBe('two\n');
		expect(bytes([1, 1])).toBe('three\n');
	});

	it('ends at the next block where it is the last its top-level block holds', () => {
		expect(blockRange(doc, [1, 1])!.to).toEqual({ part: 3, offset: 0 });
		expect(blockRange(doc, [1, 0])!.to.part).toBe(2);
	});

	it('is null for a path that holds no block', () => {
		expect([blockRange(doc, [3]), blockRange(doc, [1, 4])]).toEqual([null, null]);
	});
});
