import { describe, it, expect } from 'vitest';
import { compileMatcher } from '$lib/search/matcher';

const ranges = (q: string, opts: Partial<Parameters<typeof compileMatcher>[1]> = {}, text = '') => {
	const r = compileMatcher(q, { caseSensitive: false, wholeWord: false, regex: false, ...opts });
	if (!r.ok) throw new Error(r.error);
	return r.matcher.findAll(text);
};

describe('compileMatcher — literal', () => {
	it('empty query yields no matches', () => {
		expect(ranges('', {}, 'anything')).toEqual([]);
	});
	it('case-insensitive by default', () => {
		expect(ranges('ab', {}, 'AB ab')).toEqual([
			{ start: 0, end: 2 },
			{ start: 3, end: 5 }
		]);
	});
	it('case-sensitive when toggled', () => {
		expect(ranges('ab', { caseSensitive: true }, 'AB ab')).toEqual([{ start: 3, end: 5 }]);
	});
	it('whole-word excludes substrings', () => {
		expect(ranges('cat', { wholeWord: true }, 'cat category')).toEqual([{ start: 0, end: 3 }]);
	});
	// 'İ' (U+0130) lowercases to two code units, shifting every index after it
	// in the folded haystack; offsets must stay in original-string space.
	it('keeps offsets in original-string space when case folding changes length', () => {
		const text = 'Iİstanbul cat';
		const r = ranges('cat', {}, text);
		expect(r).toEqual([{ start: 10, end: 13 }]);
		expect(text.slice(r[0].start, r[0].end)).toBe('cat');
	});
	it('fold-safe fallback still honors wholeWord', () => {
		expect(ranges('cat', { wholeWord: true }, 'İ catalog cat')).toEqual([{ start: 10, end: 13 }]);
	});
});

describe('compileMatcher — regex', () => {
	it('returns an error for an invalid pattern instead of throwing', () => {
		const r = compileMatcher('(', { caseSensitive: false, wholeWord: false, regex: true });
		expect(r.ok).toBe(false);
	});
	it('captures groups for replace', () => {
		const r = ranges('(a)(b)', { regex: true }, 'ab');
		expect(r[0]).toMatchObject({ start: 0, end: 2, groups: ['ab', 'a', 'b'] });
	});
	it('advances past a zero-width match (no infinite loop)', () => {
		expect(ranges('x*', { regex: true }, 'abc').length).toBe(4); // empty match at each boundary
	});
});
