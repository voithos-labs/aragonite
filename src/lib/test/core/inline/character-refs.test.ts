import { describe, it, expect } from 'vitest';
import { matchCharacterReference } from '../../../core/inline/character-refs';
import { parseInline } from '../../../core/inline';

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

describe('parseInline — entity reference integration', () => {
	it('recognizes named entity in plain text', () => {
		const raw = 'a &copy; b';
		const nodes = parseInline(raw, 0, raw.length);
		const refs = nodes.filter((n) => n.kind === 'entityReference');
		expect(refs).toHaveLength(1);
		expect(refs[0].decoded).toBe('©');
	});

	it('handles multiple references in one input', () => {
		const raw = 'a&copy;b&amp;c';
		const nodes = parseInline(raw, 0, raw.length);
		const refs = nodes.filter((n) => n.kind === 'entityReference');
		expect(refs).toHaveLength(2);
		expect(refs[0].decoded).toBe('©');
		expect(refs[1].decoded).toBe('&');
	});

	it('entity inside code span is inert', () => {
		const raw = '`&copy;`';
		const nodes = parseInline(raw, 0, raw.length);
		expect(nodes.some((n) => n.kind === 'entityReference')).toBe(false);
		expect(nodes.some((n) => n.kind === 'inlineCode')).toBe(true);
	});

	it('entity composes with surrounding emphasis', () => {
		const raw = '*&copy;*';
		const nodes = parseInline(raw, 0, raw.length);
		const em = nodes.find((n) => n.kind === 'emphasis');
		expect(em).toBeDefined();
		expect(em?.children?.some((c) => c.kind === 'entityReference')).toBe(true);
	});

	it('entity and link in same paragraph: entity preserved', () => {
		const raw = '&copy; [text](https://example.com)';
		const nodes = parseInline(raw, 0, raw.length);
		const refs = nodes.filter((n) => n.kind === 'entityReference');
		expect(refs).toHaveLength(1);
		expect(refs[0].decoded).toBe('©');
		expect(nodes.some((n) => n.kind === 'link')).toBe(true);
	});

	it('entity adjacent to autolink URL: entity not absorbed', () => {
		const raw = 'see https://example.com/?a&amp;b end';
		const nodes = parseInline(raw, 0, raw.length);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		const refs = nodes.filter((n) => n.kind === 'entityReference');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('https://example.com/?a');
		expect(refs).toHaveLength(1);
		expect(refs[0].decoded).toBe('&');
	});
});
