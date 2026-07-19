import { describe, it, expect } from 'vitest';
import { inlineOf } from './inline-test-helpers';

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
		// The named-entity form must halt the url at the same upstream entity
		// boundary as the &amp; form, so a fix applied to one arm can't skip the other.
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
	it('autolinks www.example.com with the inserted http scheme', () => {
		const raw = 'Visit www.example.com today';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('http://www.example.com');
	});

	it('autolinks WWW.EXAMPLE.COM (case insensitive prefix)', () => {
		const raw = 'See WWW.EXAMPLE.COM here';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('http://WWW.EXAMPLE.COM');
	});

	it('autolinks www. with path and query', () => {
		const raw = 'go to www.example.com/foo?a=1';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('http://www.example.com/foo?a=1');
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
		expect(autolinks[0].url).toBe('http://www.example.com');
	});
});
