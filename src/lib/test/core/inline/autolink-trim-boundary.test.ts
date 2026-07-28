import { describe, it, expect } from 'vitest';
import {
	trimTrailingPunctuation,
	isValidLeadingBoundary
} from '../../../core/inline/scan/autolinks';

describe('trimTrailingPunctuation (GFM §6.9)', () => {
	it('strips trailing period, comma, exclamation, question, colon, asterisk, underscore, tilde', () => {
		for (const punct of ['.', ',', '!', '?', ':', '*', '_', '~']) {
			const raw = `https://example.com${punct}`;
			expect(trimTrailingPunctuation(raw, 0, raw.length)).toBe('https://example.com'.length);
		}
	});

	it('strips multiple trailing punctuation chars in sequence', () => {
		const raw = 'https://example.com.,!';
		expect(trimTrailingPunctuation(raw, 0, raw.length)).toBe('https://example.com'.length);
	});

	it('keeps closing paren when matched by an earlier opening paren in the URL', () => {
		const raw = 'https://example.com/foo(bar)';
		expect(trimTrailingPunctuation(raw, 0, raw.length)).toBe(raw.length);
	});

	it('strips closing paren when there is no matching opening paren', () => {
		const raw = 'https://example.com)';
		expect(trimTrailingPunctuation(raw, 0, raw.length)).toBe('https://example.com'.length);
	});

	it('keeps a trailing semicolon that does not resemble an entity reference', () => {
		// GFM §6.9: `;` is not trailing punctuation — a bare `;` stays in the url.
		const raw = 'https://example.com;';
		expect(trimTrailingPunctuation(raw, 0, raw.length)).toBe(raw.length);
	});

	it('excludes an entity-shaped tail (& + alphanumerics + ;), stripping back through the &', () => {
		// GFM §6.9 example 626: `&hl;` resembles an entity reference, so the whole
		// `&hl;` — the `&` and everything after — is excluded from the url.
		const raw = 'https://example.com/?q=&hl;';
		expect(trimTrailingPunctuation(raw, 0, raw.length)).toBe('https://example.com/?q='.length);
	});

	it('excludes an entity-shaped tail containing digits', () => {
		const raw = 'https://example.com/?q=&bogus08;';
		expect(trimTrailingPunctuation(raw, 0, raw.length)).toBe('https://example.com/?q='.length);
	});

	it('keeps a semicolon after an ampersand with no alphanumeric run (not entity-shaped)', () => {
		const raw = 'https://example.com/?a=&;';
		expect(trimTrailingPunctuation(raw, 0, raw.length)).toBe(raw.length);
	});

	it('returns the input end when no trailing punctuation is present', () => {
		const raw = 'https://example.com/foo';
		expect(trimTrailingPunctuation(raw, 0, raw.length)).toBe(raw.length);
	});

	it('respects the urlStart bound when counting parens (offset case)', () => {
		const raw = 'see https://example.com/(a)';
		expect(trimTrailingPunctuation(raw, 4, raw.length)).toBe(raw.length);
	});
});

describe('isValidLeadingBoundary (GFM §6.9)', () => {
	it('true at start-of-region', () => {
		expect(isValidLeadingBoundary('https://x.com', 0, 0)).toBe(true);
	});

	it('true after whitespace', () => {
		expect(isValidLeadingBoundary('see https://x.com', 4, 0)).toBe(true);
	});

	it('true after open paren', () => {
		expect(isValidLeadingBoundary('(https://x.com)', 1, 0)).toBe(true);
	});

	it('true after emphasis markers (* _ ~)', () => {
		expect(isValidLeadingBoundary('*https://x.com', 1, 0)).toBe(true);
		expect(isValidLeadingBoundary('_https://x.com', 1, 0)).toBe(true);
		expect(isValidLeadingBoundary('~https://x.com', 1, 0)).toBe(true);
	});

	it('false when preceded by an alphanumeric char (mid-word)', () => {
		expect(isValidLeadingBoundary('xhttps://x.com', 1, 0)).toBe(false);
	});

	it('false when preceded by other non-boundary punctuation', () => {
		expect(isValidLeadingBoundary('a/https://x.com', 2, 0)).toBe(false);
	});
});
