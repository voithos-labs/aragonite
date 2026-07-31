import { describe, it, expect } from 'vitest';
import { inlineOf } from './inline-test-helpers';

describe('parseInline — autolinks', () => {
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

	it('non-URL angle brackets are not autolinks', () => {
		// Absence only: `<world>` does match the §6.6 raw-HTML grammar as a type-7 open tag,
		// which is spec-correct and a separate concern from autolink detection.
		const nodes = inlineOf('Hello <world> end');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('autolink stops at entity boundary (&amp;)', () => {
		const nodes = inlineOf('see https://example.com/?a&amp;b end');
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('https://example.com/?a');
	});

	it('non-http scheme angle autolink (ftp)', () => {
		const nodes = inlineOf('Get <ftp://files.example.com/x> here');
		expect(nodes[1].kind).toBe('autolink');
		expect(nodes[1].url).toBe('ftp://files.example.com/x');
	});

	it('mailto scheme angle autolink keeps the scheme verbatim (no double prefix)', () => {
		const nodes = inlineOf('Mail <mailto:a@b.com> now');
		expect(nodes[1].kind).toBe('autolink');
		expect(nodes[1].url).toBe('mailto:a@b.com');
	});

	it('irc and custom (+.-) schemes autolink', () => {
		for (const uri of ['irc://chat.example.com', 'a+b-c.d://x']) {
			const nodes = inlineOf(`see <${uri}> end`);
			expect(nodes[1].kind).toBe('autolink');
			expect(nodes[1].url).toBe(uri);
		}
	});

	it('uppercase scheme autolinks', () => {
		const nodes = inlineOf('see <HTTPS://example.com> end');
		expect(nodes[1].kind).toBe('autolink');
		expect(nodes[1].url).toBe('HTTPS://example.com');
	});

	it('one-char scheme is not an autolink (min scheme length 2)', () => {
		const nodes = inlineOf('see <a:b> end');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('whitespace in the body rejects the autolink', () => {
		const nodes = inlineOf('see <ftp://a b> end');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('bare email angle autolink still works (mailto prefixed)', () => {
		const nodes = inlineOf('Mail <foo@bar.com> now');
		expect(nodes[1].kind).toBe('autolink');
		expect(nodes[1].url).toBe('mailto:foo@bar.com');
	});

	it('scheme autolink adjacent to inline raw-HTML does not fight over the brackets', () => {
		const nodes = inlineOf('<b>x</b> <ftp://h/p>');
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('ftp://h/p');
	});
});

describe('angle-bracket email autolink (CommonMark §6.5)', () => {
	it('autolinks <foo@bar.com>', () => {
		const raw = 'contact <foo@bar.com> please';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('mailto:foo@bar.com');
	});

	it('start/end span includes the angle brackets', () => {
		const raw = '<foo@bar.com>';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].start).toBe(0);
		expect(autolinks[0].end).toBe(raw.length);
	});

	// No single-segment-domain rejection pin: §6.5's regex accepts `<foo@bar>`, and the
	// accepting shape is pinned in the scan suite.

	it('rejects email with internal whitespace', () => {
		const nodes = inlineOf('<foo @bar.com>');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('rejects empty local part', () => {
		const nodes = inlineOf('<@bar.com>');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('rejects empty inner <>', () => {
		const nodes = inlineOf('see <> end');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('rejects trailing dot in inner <foo@bar.>', () => {
		const nodes = inlineOf('<foo@bar.>');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('rejects trailing hyphen in domain <foo@bar.com->', () => {
		// Pins the surviving last === '-' post-check; the regex would otherwise accept.
		const nodes = inlineOf('<foo@bar.com->');
		expect(nodes.every((n) => n.kind !== 'autolink')).toBe(true);
	});

	it('still autolinks <https://...> URL form (regression)', () => {
		const nodes = inlineOf('<https://example.com>');
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('https://example.com');
	});
});
