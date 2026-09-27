import { describe, expect, it } from 'vitest';
import {
	resolveDelimiterAutoPair,
	resolveEmptyPairBackspace
} from '$lib/components/blocks/text/delimiter-autopair';
import type { ContentRange } from '$lib/core/inline';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { fixtureReading } from '$lib/test/harness/fixture-grammar';

// The auto-pair drops the partner of an empty pair it wrote, but a tilde pairs only as a double
// run, so `~|~` is two bytes the user wrote and a key between them keeps both.
// Miss-analysis: GH #462, the empty-pair rows used only pairs the auto-pair writes, never `~|~`.

const whole = (text: string) => ({ start: 0, end: text.length });
const type = (text: string, caret: number, typed: string, own: ContentRange | null = null) =>
	resolveDelimiterAutoPair(text, whole(text), caret, typed, fixtureReading(), { ownPair: own });

describe('a key between two single tildes', () => {
	it.each([
		['a strikethrough opener', '~~b', 1],
		['a run after a word', 'a~~b', 2],
		['a run after emphasis', '*a*~~b', 4]
	])('is left to the browser in %s', (_label, text, caret) => {
		expect(type(text, caret, ' ')).toBeNull();
		expect(type(text, caret, 'x')).toBeNull();
	});

	it('is kept by Backspace, which takes one tilde as it would any byte', () => {
		expect(resolveEmptyPairBackspace('~~b', 1, null, defaultGrammarView)).toBeNull();
	});
});

describe('the pairs the auto-pair writes still collapse', () => {
	it('drops the partner of a single asterisk pair and a double tilde pair', () => {
		expect(type('a **', 3, ' ', { start: 2, end: 4 })).toEqual({
			kind: 'write',
			text: 'a * ',
			caret: 4
		});
		expect(type('a ~~~~', 4, ' ', { start: 2, end: 6 })).toEqual({
			kind: 'write',
			text: 'a ~~ ',
			caret: 5
		});
	});

	it('takes both runs of a double tilde pair on Backspace', () => {
		expect(
			resolveEmptyPairBackspace('a ~~~~', 4, { start: 2, end: 6 }, defaultGrammarView)
		).toEqual({ kind: 'write', text: 'a ', caret: 2 });
	});
});
