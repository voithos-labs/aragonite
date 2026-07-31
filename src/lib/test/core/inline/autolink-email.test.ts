import { describe, it, expect } from 'vitest';
import { inlineOf } from './inline-test-helpers';

/**
 * GFM §6.9's extended email autolink. The domain half answers to cmark-gfm, which is what
 * GitHub runs and what settles the corners the spec's prose leaves loose. The one place
 * this module keeps the spec against cmark-gfm is the leading boundary — see the two
 * boundary rows, which cmark-gfm links because it guards only the `www.` form.
 */

function emailAutolinks(source: string) {
	return inlineOf(source).filter((node) => node.kind === 'autolink');
}

const LINKS: [string, string, string][] = [
	['at sentence position', 'Email me at foo@bar.com please', 'foo@bar.com'],
	['at start of region', 'foo@bar.com', 'foo@bar.com'],
	['dot, plus, underscore, hyphen in the local part', 'a.b+c_d-e@x.com', 'a.b+c_d-e@x.com'],
	['multi-label domain', 'foo@a.b.c.example.com', 'foo@a.b.c.example.com'],
	['hyphen inside a domain label', 'foo@bar-baz.example.com', 'foo@bar-baz.example.com'],
	['underscore inside a domain label', 'a@b_c.com', 'a@b_c.com'],
	['label ending in a hyphen, mid-domain', 'foo@bar-.com', 'foo@bar-.com'],
	['trailing period is outside the address', 'Email me at foo@bar.com.', 'foo@bar.com'],
	['spec example: dots and dashes both sides', 'a.b-c_d@a.b', 'a.b-c_d@a.b'],
	['spec example: only a period may end it', 'a.b-c_d@a.b.', 'a.b-c_d@a.b']
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
	['two @ characters', 'foo@bar@example.com']
];

describe('bare email autolink (GFM §6.9)', () => {
	it.each(LINKS)('links %s', (_label, source, linked) => {
		const links = emailAutolinks(source);
		expect(links).toHaveLength(1);
		expect(source.slice(links[0].start, links[0].end)).toBe(linked);
		expect(links[0].url).toBe(`mailto:${linked}`);
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
