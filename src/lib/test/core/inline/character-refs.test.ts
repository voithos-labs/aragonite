import { describe, it, expect } from 'vitest';
import { matchCharacterReference } from '../../../core/inline/character-refs';

const matchAll = (raw: string) => matchCharacterReference(raw, 0, raw.length);

describe('matchCharacterReference', () => {
	it('decodes representative named entities', () => {
		const cases: Array<[string, string]> = [
			['&copy;', '©'],
			['&amp;', '&'],
			['&nbsp;', String.fromCharCode(0xa0)],
			['&mdash;', '—']
		];
		for (const [raw, decoded] of cases) {
			const ref = matchAll(raw);
			expect(ref, raw).not.toBeNull();
			expect(ref!.start).toBe(0);
			expect(ref!.end).toBe(raw.length);
			expect(ref!.decoded).toBe(decoded);
		}
	});

	it('is case-sensitive for named entities', () => {
		expect(matchAll('&Aacute;')!.decoded).toBe('Á');
		expect(matchAll('&aacute;')!.decoded).toBe('á');
	});

	it('rejects unknown named entities', () => {
		expect(matchAll('&notreal;')).toBeNull();
	});

	it('rejects inherited Object.prototype names as named entities', () => {
		for (const raw of ['&toString;', '&constructor;', '&hasOwnProperty;', '&__proto__;']) {
			expect(matchAll(raw), raw).toBeNull();
		}
	});

	it('decodes decimal numeric references', () => {
		expect(matchAll('&#39;')!.decoded).toBe("'");
	});

	it('decodes hex numeric references with both x and X', () => {
		expect(matchAll('&#x22;')!.decoded).toBe('"');
		expect(matchAll('&#X22;')!.decoded).toBe('"');
	});

	it('replaces zero, out-of-range, and surrogate code points with U+FFFD', () => {
		for (const raw of ['&#0;', '&#x110000;', '&#xD800;']) {
			expect(matchAll(raw)!.decoded, raw).toBe('�');
		}
	});

	it('rejects malformed numeric references', () => {
		for (const raw of ['&#abc;', '&#xZZ;', '&#;', '&#x;', '&;', '&amp', '&']) {
			expect(matchAll(raw), raw).toBeNull();
		}
	});

	it('rejects decimal references with more than 7 digits', () => {
		expect(matchAll('&#12345678;')).toBeNull();
	});

	it('rejects hex references with more than 6 digits', () => {
		expect(matchAll('&#x1234567;')).toBeNull();
	});
});
