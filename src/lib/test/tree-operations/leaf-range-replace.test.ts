// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { replaceRangeInLeaf } from '#lib/tree-operations/leaf-range.js';
import { cleanLiveJoinSeam } from '#lib/components/blocks/text/live-join-seam.js';
import {
	registerLiveJoinSeamCleaner,
	__resetLiveJoinSeamCleanerForTests
} from '#lib/schema/inline-construct-policy.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { fixtureReading, topLevelStore } from '../harness/fixture-grammar';

// A range replaced inside one block: when the join cleans and when the plain splice stands, where
// typed bytes land, and that it returns the block's whole raw, trailing line ending included.

beforeEach(() => registerLiveJoinSeamCleaner(cleanLiveJoinSeam));
afterEach(() => __resetLiveJoinSeamCleanerForTests());

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
	const { raw, caret, matchesBrowserEdit } = replaceRangeInLeaf(node, { start, end }, typed, store);
	return matchesBrowserEdit ? null : { raw, caret };
};

const edit = (source: string, start: number, end: number, typed: string) =>
	editIn('live', source, start, end, typed);

// `**bold**` at 5, ` and ` at 13, `*italic*` at 18: offsets 9 and 21 sit inside each construct.
const MIXED = 'Some **bold** and *italic* words\n';

describe('a selection edit the join has something to clean', () => {
	it('deletes the range and takes the stranded runs with it', () => {
		expect(edit(MIXED, 9, 21, '')).toEqual({ raw: 'Some boalic words\n', caret: 7 });
	});

	// The caret is the cleaned join plus what was typed, not the start before the edit: two marker
	// bytes went from ahead of it, and a caret read before the cleanup would sit two late.
	it('lands the typed text at the cleaned join', () => {
		expect(edit(MIXED, 9, 21, 'X')).toEqual({ raw: 'Some boXalic words\n', caret: 8 });
	});

	it('returns the block whole, trailing line ending included', () => {
		expect(edit('Some **bold** and *italic* words\r\n', 9, 21, '')?.raw).toBe(
			'Some boalic words\r\n'
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

	it('a live edit with no cleaner registered', () => {
		__resetLiveJoinSeamCleanerForTests();
		expect(edit(MIXED, 9, 21, 'X')).toBeNull();
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
