import { describe, it, expect } from 'vitest';
import type { InlineNode } from '../../../core/nodes';
import { scanCharacterReferences } from '../../../core/inline/character-refs';

describe('scanCharacterReferences', () => {
	it('decodes representative named entities', () => {
		const cases: Array<[string, string]> = [
			['&copy;', '©'],
			['&amp;', '&'],
			['&nbsp;', String.fromCharCode(0xa0)],
			['&mdash;', '—']
		];
		for (const [raw, decoded] of cases) {
			const result = scanCharacterReferences(raw, 0, raw.length, []);
			const refs = result.filter((n) => n.kind === 'entityReference');
			expect(refs, raw).toHaveLength(1);
			expect(refs[0].start).toBe(0);
			expect(refs[0].end).toBe(raw.length);
			expect(refs[0].decoded).toBe(decoded);
		}
	});

	it('is case-sensitive for named entities', () => {
		const upper = scanCharacterReferences('&Aacute;', 0, 8, []);
		const lower = scanCharacterReferences('&aacute;', 0, 8, []);
		expect(upper[0].decoded).toBe('Á');
		expect(lower[0].decoded).toBe('á');
	});

	it('rejects unknown named entities', () => {
		const result = scanCharacterReferences('&notreal;', 0, 9, []);
		expect(result.every((n) => n.kind === 'text')).toBe(true);
	});

	it('decodes decimal numeric references', () => {
		const result = scanCharacterReferences('&#39;', 0, 5, []);
		const refs = result.filter((n) => n.kind === 'entityReference');
		expect(refs).toHaveLength(1);
		expect(refs[0].decoded).toBe("'");
	});

	it('decodes hex numeric references with both x and X', () => {
		const lower = scanCharacterReferences('&#x22;', 0, 6, []);
		const upper = scanCharacterReferences('&#X22;', 0, 6, []);
		expect(lower[0].decoded).toBe('"');
		expect(upper[0].decoded).toBe('"');
	});

	it('replaces zero with U+FFFD', () => {
		const result = scanCharacterReferences('&#0;', 0, 4, []);
		expect(result[0].decoded).toBe('�');
	});

	it('replaces out-of-range code points with U+FFFD', () => {
		const result = scanCharacterReferences('&#x110000;', 0, 10, []);
		expect(result[0].decoded).toBe('�');
	});

	it('replaces surrogates with U+FFFD', () => {
		const result = scanCharacterReferences('&#xD800;', 0, 8, []);
		expect(result[0].decoded).toBe('�');
	});

	it('rejects malformed numeric references as text', () => {
		const cases = ['&#abc;', '&#xZZ;', '&#;', '&#x;', '&;', '&amp', '&'];
		for (const raw of cases) {
			const result = scanCharacterReferences(raw, 0, raw.length, []);
			expect(
				result.every((n) => n.kind === 'text'),
				raw
			).toBe(true);
		}
	});

	it('rejects decimal references with more than 7 digits', () => {
		const result = scanCharacterReferences('&#12345678;', 0, 11, []);
		expect(result.every((n) => n.kind === 'text')).toBe(true);
	});

	it('rejects hex references with more than 6 digits', () => {
		const result = scanCharacterReferences('&#x1234567;', 0, 11, []);
		expect(result.every((n) => n.kind === 'text')).toBe(true);
	});

	it('skips inside occupied ranges', () => {
		const raw = 'a `&copy;` b';
		const codeSpan: InlineNode = { kind: 'inlineCode', start: 2, end: 10, text: '&copy;' };
		const result = scanCharacterReferences(raw, 0, raw.length, [codeSpan]);
		const refs = result.filter((n) => n.kind === 'entityReference');
		expect(refs).toHaveLength(0);
	});

	it('emits absolute offsets when scanning a sub-range', () => {
		const raw = 'xx&copy;yy';
		const result = scanCharacterReferences(raw, 2, 8, []);
		const ref = result.find((n) => n.kind === 'entityReference');
		expect(ref?.start).toBe(2);
		expect(ref?.end).toBe(8);
	});

	it('handles multiple references in one input', () => {
		const raw = 'a&copy;b&amp;c';
		const result = scanCharacterReferences(raw, 0, raw.length, []);
		const refs = result.filter((n) => n.kind === 'entityReference');
		expect(refs).toHaveLength(2);
		expect(refs[0].decoded).toBe('©');
		expect(refs[1].decoded).toBe('&');
	});
});
