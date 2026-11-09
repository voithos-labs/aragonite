// Miss-analysis: every suggestion row asked for a word with a one-edit fix, so nothing measured
// the two-edit search a word with no fix falls through to (1.4 s on the main thread).
import { describe, expect, it } from 'vitest';
import { AFF, DIC } from '#packages/spellcheck/src/english/en-us-data.js';
import { readHunspell } from '#packages/spellcheck/src/english/hunspell.js';
import type { WordList } from '#packages/spellcheck/src/english/word-form.js';
import { suggestFor } from '#packages/spellcheck/src/english/suggester.js';

const words = readHunspell(AFF, DIC);

/** The same word list, counting every lookup made into it. */
function counted(list: WordList): { list: WordList; lookups: () => number } {
	let lookups = 0;
	class CountingSet extends Set<string> {
		has(value: string): boolean {
			lookups++;
			return super.has(value);
		}
	}
	return {
		list: {
			...list,
			forms: new CountingSet(list.forms),
			lowerForms: new CountingSet(list.lowerForms)
		},
		lookups: () => lookups
	};
}

describe('suggestFor: the search is bounded', () => {
	it.each(['qzxwvutsrpon', 'abcdefghijkl', 'Qzxwvutsrpon'])(
		'a %s-shaped word with no fix stays within the lookup budget',
		(word) => {
			const { list, lookups } = counted(words);
			expect(suggestFor(list, word)).toEqual([]);
			expect(lookups()).toBeLessThanOrEqual(200_000);
		}
	);

	it('still finds a fix two edits away', () => {
		expect(suggestFor(words, 'acomodate')).toContain('accommodate');
	});
});
