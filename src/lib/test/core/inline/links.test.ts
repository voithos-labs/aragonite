import { describe, it, expect } from 'vitest';
import { parseInline } from '../../../core/inline';
import { trimTrailingPunctuation, isValidLeadingBoundary } from '../../../core/inline/links';

function inlineOf(rawContent: string) {
	return parseInline(rawContent, 0, rawContent.length);
}

describe('parseInline — autolinks (Stage 3)', () => {
	it('angle-bracket autolink', () => {
		const nodes = inlineOf('Visit <https://example.com> now');
		expect(nodes[1].kind).toBe('autolink');
		expect(nodes[1].url).toBe('https://example.com');
	});

	it('bare URL autolink', () => {
		const nodes = inlineOf('Visit https://example.com now');
		expect(nodes[1].kind).toBe('autolink');
		expect(nodes[1].url).toBe('https://example.com');
	});

	it('non-URL angle brackets are text', () => {
		const nodes = inlineOf('Hello <world> end');
		expect(nodes.every((n) => n.kind === 'text')).toBe(true);
	});

	it('autolink still stops at entity boundary (regression guard for 1d44f0f)', () => {
		const nodes = inlineOf('see https://example.com/?a&amp;b end');
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('https://example.com/?a');
	});
});

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

	it('strips final semicolon when not preceded by HTML entity shape', () => {
		const raw = 'https://example.com;';
		expect(trimTrailingPunctuation(raw, 0, raw.length)).toBe('https://example.com'.length);
	});

	it('keeps final semicolon when preceded by HTML entity shape (&copy;)', () => {
		const raw = 'https://example.com/?a=&copy;';
		expect(trimTrailingPunctuation(raw, 0, raw.length)).toBe(raw.length);
	});

	it('keeps final semicolon when preceded by numeric entity (&#39;)', () => {
		const raw = "https://example.com/?a=&#39;";
		expect(trimTrailingPunctuation(raw, 0, raw.length)).toBe(raw.length);
	});

	it('keeps final semicolon when preceded by hex entity (&#x27;)', () => {
		const raw = 'https://example.com/?a=&#x27;';
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

describe('bare http/https autolink — trim + boundary (GFM §6.9)', () => {
	it('strips trailing period at end of sentence', () => {
		const raw = 'Visit https://example.com.';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('https://example.com');
		expect(autolinks[0].end).toBe(raw.length - 1);
	});

	it('keeps trailing matched paren', () => {
		const raw = 'See https://en.wikipedia.org/wiki/Foo_(bar) here';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('https://en.wikipedia.org/wiki/Foo_(bar)');
	});

	it('strips trailing unmatched paren', () => {
		const raw = '(see https://example.com)';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('https://example.com');
	});

	it('autolink stops at named-entity boundary (&copy;)', () => {
		// Sibling regression of the 1d44f0f guard — the named entity (&copy;) form
		// exercises the same upstream-boundary path as the &amp; form above.
		const raw = 'foo https://example.com/?a=&copy; bar';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('https://example.com/?a=');
	});

	it('does not autolink mid-word', () => {
		const nodes = inlineOf('xhttps://example.com');
		expect(nodes.every((n) => n.kind === 'text')).toBe(true);
	});

	it('does autolink at start-of-region', () => {
		const nodes = inlineOf('https://example.com');
		expect(nodes[0].kind).toBe('autolink');
		expect(nodes[0].url).toBe('https://example.com');
	});

	it('does autolink after open paren', () => {
		const raw = '(https://example.com)';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('https://example.com');
	});
});
