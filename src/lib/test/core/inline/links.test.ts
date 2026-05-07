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

describe('bare www. autolink (GFM §6.9)', () => {
	it('autolinks www.example.com', () => {
		const raw = 'Visit www.example.com today';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('www.example.com');
	});

	it('autolinks WWW.EXAMPLE.COM (case insensitive prefix)', () => {
		const raw = 'See WWW.EXAMPLE.COM here';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('WWW.EXAMPLE.COM');
	});

	it('autolinks www. with path and query', () => {
		const raw = 'go to www.example.com/foo?a=1';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('www.example.com/foo?a=1');
	});

	it('does not autolink mid-word', () => {
		const nodes = inlineOf('xwww.example.com');
		expect(nodes.every((n) => n.kind === 'text')).toBe(true);
	});

	it('does not autolink lone "www" without dot', () => {
		const nodes = inlineOf('Visit www today');
		expect(nodes.every((n) => n.kind === 'text')).toBe(true);
	});

	it('does not autolink "www." with empty domain', () => {
		const nodes = inlineOf('Visit www. today');
		expect(nodes.every((n) => n.kind === 'text')).toBe(true);
	});

	it('strips trailing punctuation', () => {
		const raw = 'See www.example.com.';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('www.example.com');
	});
});

describe('bare email autolink (GFM §6.9)', () => {
	it('autolinks foo@bar.com at sentence position', () => {
		const raw = 'Email me at foo@bar.com please';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('mailto:foo@bar.com');
		expect(raw.slice(autolinks[0].start, autolinks[0].end)).toBe('foo@bar.com');
	});

	it('autolinks email at start-of-region', () => {
		const nodes = inlineOf('foo@bar.com');
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('mailto:foo@bar.com');
	});

	it('accepts dots, plus, underscore, hyphen in local part', () => {
		const raw = 'a.b+c_d-e@example.com';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('mailto:a.b+c_d-e@example.com');
	});

	it('accepts multi-segment domain', () => {
		const raw = 'foo@a.b.c.example.com';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('mailto:foo@a.b.c.example.com');
	});

	it('accepts hyphen inside domain segments', () => {
		const raw = 'foo@bar-baz.example.com';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('mailto:foo@bar-baz.example.com');
	});

	it('rejects email when last domain char is hyphen (GFM rule)', () => {
		const nodes = inlineOf('foo@bar-.com');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('excludes trailing underscore from domain (GFM)', () => {
		const raw = 'foo@bar.com_';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('mailto:foo@bar.com');
		// Trailing _ is outside EMAIL_DOMAIN_CHAR; the segment scan halts at 'm'
		// and the underscore lands as text, same as a trailing whitespace.
	});

	it('rejects when an inner segment ends in hyphen', () => {
		// Inner-segment trailing dash exercises the in-loop break — distinct from
		// the first-segment dash check covered above.
		const raw = 'foo@bar.baz-';
		const nodes = inlineOf(raw);
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('rejects single-segment domain', () => {
		const nodes = inlineOf('foo@bar');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('rejects when local-part preceded by non-boundary char', () => {
		// 'a/' supplies a leading '/' outside the boundary allow-list. The
		// local-part scan walks back to 'x', then isValidLeadingBoundary sees
		// '/' at the position before and rejects.
		const nodes = inlineOf('a/xfoo@bar.com');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('rejects email with empty local-part', () => {
		const nodes = inlineOf('@bar.com');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('rejects email-shaped string with two @ chars', () => {
		const nodes = inlineOf('foo@bar@example.com');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('strips trailing period at sentence end', () => {
		const raw = 'Email me at foo@bar.com.';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('mailto:foo@bar.com');
	});
});
