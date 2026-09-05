import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { installPlugins } from '$lib';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { resetPluginPlatformForTests } from '$lib/testing';
import { parrotPlugin, PARROT } from '$lib/plugins/parrot';
import { roundTripCases } from '$lib/test/support/round-trip';

// The parrot's registrar is module-private (the plugin keeps the guide's bytes), so the
// plugin unit is the only door in — the one a consumer installs through.
const installParrot = () => installPlugins([parrotPlugin()]);

beforeEach(resetPluginPlatformForTests);
afterEach(resetPluginPlatformForTests);

// Uninstalled, the marker is ordinary prose: the bytes a consumer without the plugin
// reads back are bare GFM, which is the whole uninstall story for a leaf like this.
describe('parrot is dormant until installed', () => {
	it('leaves a %%parrot line as a paragraph with nothing installed', () => {
		const src = '%%parrot party responsibly\n';
		expect(parse(src).children[0].kind).toBe('paragraph');
		expect(serialize(parse(src))).toBe(src);
	});
});

// The opener claims a line on the bare `%%parrot` prefix, with no separator demanded —
// so `%%parrots` is a parrot whose caption starts mid-word. Pinned as the grammar it is.
describe('parrot recognition', () => {
	beforeEach(installParrot);

	const recognition: Array<[string, string, boolean]> = [
		['marker with a caption', '%%parrot party responsibly\n', true],
		['bare marker', '%%parrot\n', true],
		['no trailing newline', '%%parrot party', true],
		['prefix takes no separator', '%%parrots dance\n', true],
		['indented one space', ' %%parrot hi\n', false],
		['truncated marker', '%%parro\n', false],
		['single percent', '%parrot\n', false],
		['marker mid-line', 'see %%parrot\n', false]
	];
	for (const [name, src, claimed] of recognition) {
		it(`${name} → ${claimed ? 'parrot' : 'paragraph'}`, () => {
			expect(parse(src).children[0].kind).toBe(claimed ? PARROT : 'paragraph');
		});
	}

	it('parses the line to a single source-holding leaf (no children)', () => {
		const node = parse('%%parrot party responsibly\n').children[0];
		expect(node.children).toBeUndefined();
		expect(node.raw).toBe('%%parrot party responsibly\n');
	});

	it('interrupts an open paragraph, splitting the parrot onto its own block', () => {
		expect(parse('intro\n%%parrot hi\n').children.map((c) => c.kind)).toEqual([
			'paragraph',
			PARROT
		]);
	});

	it('is recognized inside a blockquote', () => {
		const quote = parse('> %%parrot hi\n').children[0];
		expect(quote.kind).toBe('blockquote');
		expect(quote.children?.[0].kind).toBe(PARROT);
	});
});

// The component derives its caption as `node.raw.slice('%%parrot'.length).trim()`, so what
// this pins is the half the parser owes it: the WHOLE line, marker and caption alike, lands
// in `raw`. The rendered caption itself is the e2e's (requirements/plugins/parrot.md).
describe('the caption bytes survive in the node raw', () => {
	beforeEach(installParrot);

	const caption = (src: string) => parse(src).children[0].raw.slice('%%parrot'.length).trim();

	it('recovers the text after the marker', () => {
		expect(caption('%%parrot party responsibly\n')).toBe('party responsibly');
	});

	it('is empty for a bare marker, and for a marker with only spacing after it', () => {
		expect(caption('%%parrot\n')).toBe('');
		expect(caption('%%parrot   \n')).toBe('');
	});
});

// Round-trip is the load-bearing guarantee: serialize re-emits `leadingTrivia + raw`, so a
// `raw` taken verbatim from the consumed line round-trips. The declined shapes prove the
// process-wide opener leaves every non-claimed byte alone.
describe('parrot round-trip', () => {
	beforeEach(installParrot);

	roundTripCases([
		'%%parrot party responsibly\n',
		'%%parrot\n',
		'Before\n\n%%parrot party responsibly\n\nAfter\n',
		'intro\n%%parrot hi\n',
		'> %%parrot hi\n',
		'%%parrot party',
		' %%parrot hi\n',
		'see %%parrot\n',
		'```\n%%parrot in code\n```\n'
	]);
});
