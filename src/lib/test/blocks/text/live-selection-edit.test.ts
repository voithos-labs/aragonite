// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { resolveSelectionEdit } from '$lib/components/blocks/text/live-selection-edit';
import { cleanLiveJoinSeam } from '$lib/components/blocks/text/live-join-seam';
import {
	registerLiveJoinSeamCleaner,
	__resetLiveJoinSeamCleanerForTests
} from '$lib/schema/inline-construct-policy';
import type { PresentationMode } from '$lib/presentation-mode';

// The one destructive path with no seam offsets of its own: a native selection edit inside ONE
// block, re-expressed as a join. Four decisions live here — when it declines, where the typed
// bytes land, and that what it returns is the block's WHOLE raw, trailing line ending included.

beforeEach(() => registerLiveJoinSeamCleaner(cleanLiveJoinSeam));
afterEach(() => __resetLiveJoinSeamCleanerForTests());

const blockOf = (source: string) => parse(source, { scope: 'fragment' }).children[0];

/** Mode first and never defaulted: an explicit `undefined` argument would take a default
 *  parameter's value, which is exactly the caller this arm has to be able to express. */
const editIn = (
	mode: PresentationMode | undefined,
	source: string,
	start: number,
	end: number,
	typed: string
) => resolveSelectionEdit(blockOf(source), { start, end }, typed, mode, undefined);

const edit = (source: string, start: number, end: number, typed: string) =>
	editIn('live', source, start, end, typed);

// `**bold**` at 5, ` and ` at 13, `*italic*` at 18 — offsets 9 and 21 sit inside each construct.
const MIXED = 'Some **bold** and *italic* words\n';

describe('a selection edit the seam has something to clean', () => {
	it('deletes the range and takes the stranded runs with it', () => {
		expect(edit(MIXED, 9, 21, '')).toEqual({ raw: 'Some boalic words\n', caret: 7 });
	});

	// The caret is the CLEANED seam plus what was typed, not the pre-edit start: two marker bytes
	// went from ahead of it, and a caret read before the cleanup would sit two characters late.
	it('lands the typed text at the cleaned seam', () => {
		expect(edit(MIXED, 9, 21, 'X')).toEqual({ raw: 'Some boXalic words\n', caret: 8 });
	});

	it('returns the block WHOLE, trailing line ending included', () => {
		expect(edit('Some **bold** and *italic* words\r\n', 9, 21, '')?.raw).toBe(
			'Some boalic words\r\n'
		);
	});
});

describe('what it declines, leaving the edit to the engine', () => {
	it('a collapsed or inverted range', () => {
		expect(edit(MIXED, 9, 9, 'X')).toBeNull();
		expect(edit(MIXED, 21, 9, 'X')).toBeNull();
	});

	// Identity: the seam found nothing to drop, so the engine's own edit is already right and
	// keeps its grapheme and IME behavior.
	it('a range whose seam has nothing to clean', () => {
		expect(edit('plain words here\n', 5, 11, 'X')).toBeNull();
		expect(edit(MIXED, 9, 11, 'X')).toBeNull();
	});

	it('every mode but live, over the very range live rewrites', () => {
		expect(editIn('source', MIXED, 9, 21, 'X')).toBeNull();
		expect(editIn('preview-inline', MIXED, 9, 21, 'X')).toBeNull();
		expect(editIn('reading', MIXED, 9, 21, 'X')).toBeNull();
		expect(editIn(undefined, MIXED, 9, 21, 'X')).toBeNull();
	});

	it('a live edit with no cleaner registered', () => {
		__resetLiveJoinSeamCleanerForTests();
		expect(edit(MIXED, 9, 21, 'X')).toBeNull();
	});
});
