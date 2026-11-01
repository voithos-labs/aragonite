// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { replaceDrawnRange, replaceRangeInLeaf } from '#lib/tree-operations/leaf-range.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { fixtureReading, topLevelStore } from '../harness/fixture-grammar';
import { isPlainSplice } from '../harness/plain-splice';

// A range replaced inside one block: when the join cleans and when the plain splice stands, where
// typed bytes land, and that it returns the block's whole raw, trailing line ending included.

const blockOf = (source: string) => parse(source, { scope: 'fragment' }).children[0];

/** Mode first and never given a default: an explicit `undefined` argument would take a default
 *  parameter's value, which is exactly the caller this has to be able to express. */
const editIn = (
	mode: PresentationMode | undefined,
	source: string,
	start: number,
	end: number,
	typed: string
) => {
	const node = blockOf(source);
	const store = topLevelStore(node, fixtureReading({}, mode));
	const edit = replaceRangeInLeaf(node, { start, end }, typed, store);
	return isPlainSplice(node, { start, end }, typed, edit)
		? null
		: { raw: edit.raw, caret: edit.caret };
};

const edit = (source: string, start: number, end: number, typed: string) =>
	editIn('live', source, start, end, typed);

// `**bold**` at 5, ` and ` at 13, `*italic*` at 18: offsets 9 and 21 sit inside each construct.
const MIXED = 'Some **bold** and *italic* words\n';

describe('a selection edit the join has something to clean', () => {
	it('deletes the range and closes and reopens the runs it cut through', () => {
		expect(edit(MIXED, 9, 21, '')).toEqual({ raw: 'Some **bo***alic* words\n', caret: 9 });
	});

	// The typed text goes inside the closer the cleanup wrote, since it takes the format of the
	// character before it, and the caret follows it there.
	it('lands the typed text inside the closed run', () => {
		expect(edit(MIXED, 9, 21, 'X')).toEqual({ raw: 'Some **boX***alic* words\n', caret: 10 });
	});

	// The bytes match the plain splice, but the typed text goes past the link's hidden bracket.
	it('lands typed text outside a link whose text the range starts', () => {
		expect(edit('see [here](u) now\n', 5, 7, 'X')).toEqual({ raw: 'see X[re](u) now\n', caret: 5 });
	});

	it('returns the block whole, trailing line ending included', () => {
		expect(edit('Some **bold** and *italic* words\r\n', 9, 21, '')?.raw).toBe(
			'Some **bo***alic* words\r\n'
		);
	});
});

describe('what it leaves to the browser’s own edit', () => {
	it('a collapsed range', () => {
		expect(edit(MIXED, 9, 9, 'X')).toBeNull();
	});

	// Unchanged: the cleanup found nothing to drop, so the browser's own edit is already right
	// and keeps its grapheme and IME behavior.
	it('a range whose join has nothing to clean', () => {
		expect(edit('plain words here\n', 5, 11, 'X')).toBeNull();
		expect(edit(MIXED, 9, 11, 'X')).toBeNull();
	});

	// Reading mode hides delimiters too, but it writes nothing, so its gestures never get here.
	it('every mode that draws the caret block’s delimiters, over the very range live rewrites', () => {
		expect(editIn('source', MIXED, 9, 21, 'X')).toBeNull();
		expect(editIn('preview-block', MIXED, 9, 21, 'X')).toBeNull();
		expect(editIn('preview-inline', MIXED, 9, 21, 'X')).toBeNull();
		expect(editIn(undefined, MIXED, 9, 21, 'X')).toBeNull();
	});
});

// The ends the browser would edit are not the ends written, so the editor writes the bytes itself.
describe('what it takes back from the browser', () => {
	it('an end inside a surrogate pair, snapped off it', () => {
		expect(edit('a\u{1F600}b\n', 0, 2, '')).toEqual({ raw: '\u{1F600}b\n', caret: 0 });
	});

	it('an inverted range, which replaces nothing', () => {
		expect(edit(MIXED, 21, 9, 'X')).not.toBeNull();
	});
});

// Miss-analysis: every row's block ended in a line break, so no row saw the splice add one.
describe('the plain splice', () => {
	it('keeps a last line with no line ending without one', () => {
		const node = blockOf('hello');
		const store = topLevelStore(node, fixtureReading({}, 'source'));
		expect(replaceRangeInLeaf(node, { start: 1, end: 4 }, '', store).raw).toBe('ho');
	});
});

// Miss-analysis: every typed or pasted payload here was plain text, so none brought runs of its
// own into a run the caret sat in, which a drag or a live copy now does.
describe('text carrying its own runs lands inside a run', () => {
	const CLOSED = 'Some **bo**d words tail\n';

	it('closes the run around it and keeps the runs that meet as one', () => {
		expect(edit(CLOSED, 9, 9, '**ld** an')).toEqual({
			raw: 'Some **bold** and words tail\n',
			caret: 16
		});
	});

	it('lands the same from past the hidden closer', () => {
		expect(edit(CLOSED, 11, 11, '**ld** an')).toEqual({
			raw: 'Some **bold** and words tail\n',
			caret: 16
		});
	});

	// What a live cut of `ld** and *it` put on the clipboard, pasted back at the caret it left.
	it('puts back what a cut through two runs took', () => {
		expect(edit('Some **bo***alic* words\n', 9, 9, '**ld** and *it*')).toEqual({
			raw: 'Some **bold** and *italic* words\n',
			caret: 21
		});
	});

	it('pasted over a selection, takes its place inside the run', () => {
		expect(edit('Some **bold** and words tail\n', 9, 16, '**X**')).toEqual({
			raw: 'Some **boX**d words tail\n',
			caret: 12
		});
	});

	// A link nested in the bold reads right as written, so the browser's own splice stands.
	it('leaves a landing that already reads right to the browser', () => {
		expect(edit('**see y**\n', 6, 6, '[x](u)')).toBeNull();
	});

	it('lands byte-literally in source mode', () => {
		expect(editIn('source', CLOSED, 9, 9, '**ld** an')).toBeNull();
	});
});

// Miss-analysis: #809, every drawn range here sat inside the text, so none covered a block's whole
// text from before its hidden markers, which a select-all or a triple click reads.
describe('a drawn range over the block’s whole text', () => {
	const drawn = (source: string, start: number, end: number, typed: string) => {
		const node = blockOf(source);
		const store = topLevelStore(node, fixtureReading({}, 'live'));
		return replaceDrawnRange(node, { start, end }, typed, store).raw;
	};

	it.each([
		['keeps a heading, typed over', '# Hi #\n', 0, 4, 'x', '# x #\n'],
		['keeps a run around it all, typed over', '**Hi**\n', 0, 6, 'x', '**x**\n'],
		['removes a link that is all of it', '[here](u)\n', 0, 9, 'X', 'X\n'],
		['leaves a paragraph, deleted', '# Hi #\n', 2, 4, '', '\n'],
		['leaves a paragraph holding a typed space', '# Hi #\n', 2, 4, ' ', ' \n']
	])('%s', (_, source, start, end, typed, written) => {
		expect(drawn(source, start, end, typed)).toBe(written);
	});

	it('leaves a range inside the text as drawn', () => {
		expect(drawn('**Hi** there\n', 0, 6, 'x')).toBe('x there\n');
	});
});
