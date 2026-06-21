import { describe, it, expect } from 'vitest';
import { expandReplacement, applyRangesToText } from '$lib/editor/search/replace';

describe('expandReplacement', () => {
	it('returns the template verbatim in literal mode (no groups)', () => {
		expect(expandReplacement('$1 & $&', undefined)).toBe('$1 & $&');
	});
	it('expands $1/$2 capture refs', () => {
		expect(expandReplacement('$2-$1', ['ab', 'a', 'b'])).toBe('b-a');
	});
	it('expands $& and $0 to the full match and $$ to a literal $', () => {
		expect(expandReplacement('[$&]', ['xy', 'x', 'y'])).toBe('[xy]');
		expect(expandReplacement('$$1', ['xy'])).toBe('$1');
	});
	it('leaves an out-of-range group ref empty', () => {
		expect(expandReplacement('$9', ['ab', 'a'])).toBe('');
	});
});

describe('applyRangesToText', () => {
	it('substitutes right-to-left so earlier offsets stay valid', () => {
		const ranges = [
			{ start: 2, end: 3 },
			{ start: 6, end: 7 }
		];
		expect(applyRangesToText('a x a x', ranges, 'yy')).toBe('a yy a yy');
	});
	it('expands captures per range in regex mode', () => {
		const ranges = [{ start: 0, end: 2, groups: ['ab', 'a', 'b'] }];
		expect(applyRangesToText('abZ', ranges, '$2$1')).toBe('baZ');
	});
});
