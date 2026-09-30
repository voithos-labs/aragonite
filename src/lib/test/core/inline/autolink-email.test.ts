import { describe, it, expect } from 'vitest';
import { inlineOf } from './inline-test-helpers';

/**
 * GFM §6.9's extended email autolink. The domain half and the `mailto:`/`xmpp:` prefixes answer
 * to cmark-gfm, which is what GitHub runs and what settles the corners the spec's prose leaves
 * loose. The one place this module keeps the spec against cmark-gfm is the leading boundary: the
 * boundary rows below link on GitHub, which guards only the `www.` form.
 */

function emailAutolinks(source: string) {
	return inlineOf(source).filter((node) => node.kind === 'autolink');
}

/** Label, source, linked text, and the href when it is not `mailto:` plus the text. */
const LINKS: [string, string, string, string?][] = [
	['at sentence position', 'Email me at foo@bar.com please', 'foo@bar.com'],
	['at start of region', 'foo@bar.com', 'foo@bar.com'],
	['dot, plus, underscore, hyphen in the local part', 'a.b+c_d-e@x.com', 'a.b+c_d-e@x.com'],
	['multi-label domain', 'foo@a.b.c.example.com', 'foo@a.b.c.example.com'],
	['hyphen inside a domain label', 'foo@bar-baz.example.com', 'foo@bar-baz.example.com'],
	['underscore inside a domain label', 'a@b_c.com', 'a@b_c.com'],
	['label ending in a hyphen, mid-domain', 'foo@bar-.com', 'foo@bar-.com'],
	['trailing period is outside the address', 'Email me at foo@bar.com.', 'foo@bar.com'],
	['spec example: dots and dashes both sides', 'a.b-c_d@a.b', 'a.b-c_d@a.b'],
	['spec example: only a period may end it', 'a.b-c_d@a.b.', 'a.b-c_d@a.b'],
	// A lowercase prefix is part of the link and of the href, never doubled.
	['a mailto: prefix', 'write mailto:foo@bar.com', 'mailto:foo@bar.com', 'mailto:foo@bar.com'],
	['an xmpp: prefix', 'xmpp:foo@bar.com', 'xmpp:foo@bar.com', 'xmpp:foo@bar.com'],
	[
		'an xmpp resource after the domain',
		'xmpp:foo@bar.com/home',
		'xmpp:foo@bar.com/home',
		'xmpp:foo@bar.com/home'
	],
	[
		'a mailto: address stops at a slash',
		'mailto:foo@bar.com/home',
		'mailto:foo@bar.com',
		'mailto:foo@bar.com'
	],
	[
		'a prefix after an open paren',
		'(mailto:foo@bar.com)',
		'mailto:foo@bar.com',
		'mailto:foo@bar.com'
	]
];

const STAYS_LITERAL: [string, string][] = [
	['spec example: domain ending in a hyphen', 'a.b-c_d@a.b-'],
	['spec example: domain ending in an underscore', 'a.b-c_d@a.b_'],
	['underscore after an otherwise complete domain', 'foo@bar.com_'],
	['last label ending in a hyphen', 'foo@bar.baz-'],
	['single-label domain', 'foo@bar'],
	['empty local part', '@bar.com'],
	// Boundary rows: the local-part scan walks back to `x` / `bar`, then the
	// preceding `/` and `@` fail the §6.9 leading boundary.
	['local part preceded by a non-boundary character', 'a/xfoo@bar.com'],
	['two @ characters', 'foo@bar@example.com'],
	// cmark-gfm matches the prefix byte for byte, so an uppercase one is a plain `:` in front of
	// the address, which the leading boundary refuses the same way it refuses `a:foo@bar.com`.
	['an uppercase MAILTO: prefix', 'MAILTO:foo@bar.com'],
	['a prefix glued to a word', 'amailto:foo@bar.com'],
	['an xmpp resource ending in a slash', 'xmpp:foo@bar.com/']
];

describe('bare email autolink (GFM §6.9)', () => {
	it.each(LINKS)('links %s', (_label, source, linked, href = `mailto:${linked}`) => {
		const links = emailAutolinks(source);
		expect(links).toHaveLength(1);
		expect(source.slice(links[0].start, links[0].end)).toBe(linked);
		expect(links[0].url).toBe(href);
	});

	it.each(STAYS_LITERAL)('leaves %s literal', (_label, source) => {
		expect(emailAutolinks(source)).toEqual([]);
	});
});

// Three domain-scan corners no spec example settles, so each is pinned against the
// implementation GitHub runs rather than against the prose.
describe('email domain corners the spec prose leaves to cmark-gfm', () => {
	it.each([
		['a domain ending in a digit', 'a@b.c1'],
		['a period followed by a non-alphanumeric', 'a@b._c']
	])('leaves %s literal', (_label, source) => {
		expect(emailAutolinks(source)).toEqual([]);
	});

	it('links a domain whose first label is empty', () => {
		const links = emailAutolinks('a@.b');
		expect(links).toHaveLength(1);
		expect(links[0].url).toBe('mailto:a@.b');
	});
});
