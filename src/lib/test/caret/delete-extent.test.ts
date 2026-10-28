// Miss-analysis: deletes were left to each engine, and no test compared what the three take.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { characterExtent, DELETE_WINDOW } from '../../caret/delete-extent';
import type { DeleteDirection } from '../../browser/input';
import { graphemeSegmenter } from '../../core/text-units';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '../../perf/instruments';

const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}';
const KEYCAP = '1️⃣';
const FLAG = '\u{1F1EB}\u{1F1F7}';
const THUMB_TONE = '\u{1F44D}\u{1F3FD}';
const E_ACUTE = 'é';
const TE = 'ते';
const GAK = '각';
// Each longer than the delete window: thirty people joined by ZWJ, a letter under 100 accents, and
// seventeen flags with one more regional indicator.
const LONG_CHAIN = Array(30).fill('\u{1F468}').join('\u200D');
const LONG_MARKS = 'a' + '\u0301'.repeat(100);
const FLAG_RUN = FLAG.repeat(17) + '\u{1F1EB}';

function take(text: string, caret: number, direction: DeleteDirection): string {
	const span = characterExtent(text, caret, direction, { start: 0, end: text.length });
	return span ? text.slice(0, span.start) + text.slice(span.end) : text;
}

describe('characterExtent: what a collapsed Backspace or Delete takes', () => {
	const rows: { name: string; text: string; caret: number; dir: DeleteDirection; after: string }[] =
		[
			// Firefox's Backspace takes one person off the family; every emoji goes whole both ways.
			{
				name: 'Backspace after a ZWJ family',
				text: `ab${FAMILY}c`,
				caret: 10,
				dir: 'backward',
				after: 'abc'
			},
			{
				name: 'Delete before a ZWJ family',
				text: `ab${FAMILY}c`,
				caret: 2,
				dir: 'forward',
				after: 'abc'
			},
			{
				name: 'Backspace after a keycap',
				text: `a${KEYCAP}b`,
				caret: 4,
				dir: 'backward',
				after: 'ab'
			},
			{
				name: 'Delete before a keycap',
				text: `a${KEYCAP}b`,
				caret: 1,
				dir: 'forward',
				after: 'ab'
			},
			{ name: 'Backspace after a flag', text: `a${FLAG}b`, caret: 5, dir: 'backward', after: 'ab' },
			{
				name: 'Backspace after a skin-tone emoji',
				text: `a${THUMB_TONE}b`,
				caret: 5,
				dir: 'backward',
				after: 'ab'
			},
			{
				name: 'Delete before a skin-tone emoji',
				text: `a${THUMB_TONE}b`,
				caret: 1,
				dir: 'forward',
				after: 'ab'
			},
			// WebKit's Backspace takes these clusters whole; Chromium and Firefox take the last mark.
			{
				name: 'Backspace after a combining accent',
				text: `x${E_ACUTE}y`,
				caret: 3,
				dir: 'backward',
				after: 'xey'
			},
			{
				name: 'Delete before a combining accent',
				text: `x${E_ACUTE}y`,
				caret: 1,
				dir: 'forward',
				after: 'xy'
			},
			{
				name: 'Backspace after a Devanagari vowel sign',
				text: `a${TE}`,
				caret: 3,
				dir: 'backward',
				after: 'aत'
			},
			{
				name: 'Delete before a Devanagari cluster',
				text: `a${TE}`,
				caret: 1,
				dir: 'forward',
				after: 'a'
			},
			{
				name: 'Backspace after a Hangul jamo syllable',
				text: `a${GAK}b`,
				caret: 4,
				dir: 'backward',
				after: 'a가b'
			},
			{
				name: 'Backspace after an astral letter',
				text: 'a\u{1D400}b',
				caret: 3,
				dir: 'backward',
				after: 'ab'
			},
			// WebKit and Firefox take one half of the pair.
			{
				name: 'Backspace after a CRLF pair',
				text: 'ab\r\ncd',
				caret: 4,
				dir: 'backward',
				after: 'abcd'
			},
			{
				name: 'Delete before a CRLF pair',
				text: 'ab\r\ncd',
				caret: 2,
				dir: 'forward',
				after: 'abcd'
			},
			{
				name: 'Backspace at a line start after LF',
				text: 'ab\ncd',
				caret: 3,
				dir: 'backward',
				after: 'abcd'
			},
			{
				name: 'Backspace takes a plain letter',
				text: 'abc',
				caret: 3,
				dir: 'backward',
				after: 'ab'
			},
			{ name: 'Backspace takes a tab', text: 'a\tb', caret: 2, dir: 'backward', after: 'ab' }
		];
	for (const row of rows) {
		it(row.name, () => expect(take(row.text, row.caret, row.dir)).toBe(row.after));
	}

	it('takes nothing at the bound it faces', () => {
		expect(characterExtent('abc', 1, 'backward', { start: 1, end: 3 })).toBeNull();
		expect(characterExtent('abc', 3, 'forward', { start: 0, end: 3 })).toBeNull();
	});

	it('never reaches past the bounds', () => {
		expect(characterExtent(`${E_ACUTE}x`, 0, 'forward', { start: 0, end: 1 })).toEqual({
			start: 0,
			end: 1
		});
		const clamped = characterExtent(`x${FAMILY}`, 9, 'backward', { start: 3, end: 9 });
		expect(clamped?.start).toBeGreaterThanOrEqual(3);
	});
});

describe('characterExtent: the window it reads', () => {
	it('reads a fixed window around the caret, whatever the block length', () => {
		const text = 'word '.repeat(2000);
		resetPerfInstruments();
		enablePerfInstruments();
		try {
			characterExtent(text, 5000, 'backward', { start: 0, end: text.length });
			characterExtent(text, 5000, 'forward', { start: 0, end: text.length });
			expect(perfSnapshot().deleteWindowUnits).toBeLessThanOrEqual(2 * DELETE_WINDOW);
		} finally {
			disablePerfInstruments();
		}
	});

	// A cluster the window cuts still goes whole: no half ZWJ chain, no accents left on the letter
	// before, no lone surrogate.
	it('takes a ZWJ sequence longer than the window whole, either way', () => {
		const text = `x${LONG_CHAIN}y`;
		expect(take(text, 1 + LONG_CHAIN.length, 'backward')).toBe('xy');
		expect(take(text, 1, 'forward')).toBe('xy');
	});

	it('takes a combining run longer than the window whole on Delete, its last mark on Backspace', () => {
		const text = `x${LONG_MARKS}y`;
		expect(take(text, 1, 'forward')).toBe('xy');
		expect(take(text, 1 + LONG_MARKS.length, 'backward')).toBe(`x${LONG_MARKS.slice(0, -1)}y`);
	});

	// Regional indicators pair from the start of their run, which the window can cut.
	it('pairs a run of regional indicators longer than the window from the run start', () => {
		const text = `a${FLAG_RUN}`;
		expect(take(text, text.length, 'backward')).toBe(`a${FLAG.repeat(17)}`);
	});

	it('never splits a surrogate pair where the window starts', () => {
		const text = `\u{1F600}${'\uFE0F'.repeat(DELETE_WINDOW - 1)}`;
		expect(take(text, text.length, 'backward')).toBe('');
	});
});

describe('characterExtent: a span never splits what the editor keeps whole', () => {
	const piece = fc.constantFrom(
		'a',
		' ',
		'\r\n',
		'\n',
		FAMILY,
		KEYCAP,
		FLAG,
		THUMB_TONE,
		E_ACUTE,
		TE,
		GAK,
		'\u{1D400}',
		LONG_CHAIN,
		LONG_MARKS,
		FLAG_RUN
	);
	it('ends on a cluster boundary going forward, and inside one only after a combining mark', () => {
		const segmenter = graphemeSegmenter()!;
		fc.assert(
			fc.property(fc.array(piece, { minLength: 1, maxLength: 12 }), fc.nat(), (pieces, pick) => {
				const text = pieces.join('');
				const boundaries = new Set([...segmenter.segment(text)].map((s) => s.index));
				boundaries.add(text.length);
				const caret = [...boundaries][pick % boundaries.size];
				const all = { start: 0, end: text.length };
				const forward = characterExtent(text, caret, 'forward', all);
				if (forward) expect(boundaries.has(forward.end)).toBe(true);
				const backward = characterExtent(text, caret, 'backward', all);
				if (backward && !boundaries.has(backward.start)) {
					// Only the last code point of a non-emoji cluster comes off, never half a pair.
					expect(text.slice(backward.start, backward.end)).toMatch(
						/^\P{Cs}$|^[\uD800-\uDBFF][\uDC00-\uDFFF]$/u
					);
					expect(text.slice(backward.start - 1, backward.end)).not.toBe('\r\n');
				}
			})
		);
	});
});
