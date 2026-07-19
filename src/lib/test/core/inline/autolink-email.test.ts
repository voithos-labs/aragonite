import { describe, it, expect } from 'vitest';
import { inlineOf } from './inline-test-helpers';

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
