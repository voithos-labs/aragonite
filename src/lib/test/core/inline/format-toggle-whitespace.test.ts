// @vitest-environment jsdom
//
// A wrap trims the selection's boundary whitespace before it writes, in every mode, so the same
// press taken three times over wraps, strips and wraps again. Miss-analysis: every case in these
// suites pressed ONCE, so the `** word**` a painting mode wrote was never handed to a second press
// — bytes no parse reads as a run, which that press doubled into `****`.
import { describe, it, expect } from 'vitest';
import { toggleInlineFormat, type InlineFormatEdit } from '$lib/core/inline/format-toggle';
import type { PresentationMode } from '$lib/presentation-mode';
import type { InlineMarkKind } from '$lib/schema/inline-construct-policy';
import { MARK_FORMATS, markersOf, whole } from './format-toggle-fixture';

const PLAIN = 'pre word post';
const MODES: PresentationMode[] = ['source', 'live'];

/** The word, with each way a user's drag can reach past it. */
const SELECTIONS = {
	word: { start: 4, end: 8 },
	'leading space': { start: 3, end: 8 },
	'trailing space': { start: 4, end: 9 },
	'both spaces': { start: 3, end: 9 }
};

/** Press `count` times, each press on the selection the write before it left — the gesture a user
 *  makes by holding one selection and pressing the chord again. A decline ends the run. */
function presses(
	format: InlineMarkKind,
	mode: PresentationMode,
	selection: { start: number; end: number },
	count: number
): (string | null)[] {
	const written: (string | null)[] = [];
	let edit: InlineFormatEdit = { display: PLAIN, content: whole(PLAIN), selection };
	for (let press = 0; press < count; press++) {
		const result = toggleInlineFormat(edit, format, mode);
		written.push(result?.newDisplay ?? null);
		if (!result) break;
		edit = {
			display: result.newDisplay,
			content: whole(result.newDisplay),
			selection: { start: result.newSelStart, end: result.newSelEnd }
		};
	}
	return written;
}

describe.each(MODES)('a toggle over boundary whitespace (%s)', (mode) => {
	for (const [reach, selection] of Object.entries(SELECTIONS)) {
		// The space cannot go inside: a run opens and closes against a word, and the cross-block
		// sibling trims the same edge before it ever asks the seam.
		it.each(MARK_FORMATS)(`wraps the word alone, ${reach} (%s)`, (format) => {
			const m = markersOf(format);
			const wrapped = `pre ${m}word${m} post`;
			expect(presses(format, mode, selection, 3)).toEqual([wrapped, PLAIN, wrapped]);
		});
	}

	// Nothing survives the trim, and a pair around a space is no construct for the next press to
	// take back off — so the sound answer is no write at all.
	it.each(MARK_FORMATS)('declines a whitespace-only selection (%s)', (format) => {
		expect(presses(format, mode, { start: 3, end: 4 }, 1)).toEqual([null]);
	});

	// The selection carries the run it wrote, which is what makes the second press a strip rather
	// than a second wrap.
	it.each(MARK_FORMATS)('leaves the run it wrote selected (%s)', (format) => {
		const m = markersOf(format);
		const edit = { display: PLAIN, content: whole(PLAIN), selection: SELECTIONS['both spaces'] };
		const result = toggleInlineFormat(edit, format, mode);
		expect(result?.newDisplay.slice(result.newSelStart, result.newSelEnd)).toBe(`${m}word${m}`);
	});
});
