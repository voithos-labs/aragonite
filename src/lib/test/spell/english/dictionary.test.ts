import { describe, expect, it } from 'vitest';
import { readDictionary } from '#lib/spell/english/dictionary.js';

const AFF = `
SET UTF-8
TRY abc
NOSUGGEST !
ONLYINCOMPOUND c
REP 2
REP ei a
REP alot a_lot

PFX U Y 1
PFX U   0     un         .

SFX D Y 2
SFX D   0     d          e
SFX D   0     ed         [^ey]

SFX S N 2
SFX S   y     ies        [^aeiou]y
SFX S   0     s          [^sxzhy]
`;

const DIC = `6
tie/DS
walk/UD
fly/S
damn/!
1th/c
and\\/or
`;

describe('readDictionary', () => {
	const dict = readDictionary(AFF, DIC);

	it('expands suffix rules under their conditions and strips', () => {
		expect(dict.forms.has('tied')).toBe(true);
		expect(dict.forms.has('ties')).toBe(true);
		expect(dict.forms.has('walked')).toBe(true);
		expect(dict.forms.has('flies')).toBe(true);
		expect(dict.forms.has('flys')).toBe(false);
	});

	it('crosses a prefix with a suffix only where both rules allow it', () => {
		expect(dict.forms.has('unwalk')).toBe(true);
		expect(dict.forms.has('unwalked')).toBe(true);
		expect(dict.forms.has('untie')).toBe(false);
	});

	it('keeps taboo entries as words a suggestion never offers', () => {
		expect(dict.forms.has('damn')).toBe(true);
		expect(dict.noSuggest.has('damn')).toBe(true);
	});

	it('leaves compound-only entries out, and reads an escaped slash as part of the word', () => {
		expect(dict.forms.has('1th')).toBe(false);
		expect(dict.forms.has('and/or')).toBe(true);
	});

	it('reads the replacement table and the try letters', () => {
		expect(dict.replacements).toEqual([
			{ from: 'ei', to: 'a' },
			{ from: 'alot', to: 'a lot' }
		]);
		expect(dict.tryChars).toBe('abc');
	});
});
