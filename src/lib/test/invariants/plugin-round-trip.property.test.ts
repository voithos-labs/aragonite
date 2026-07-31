import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { installPlugins } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { isBlockKindRegistered } from '../../schema/block-kind-descriptor';
import { footnotesPlugin, FOOTNOTE_DEF_KIND } from '$lib/plugins/footnotes';
import { emojiPlugin } from '$lib/plugins/emoji';
import { latexPlugin, MATH_BLOCK } from '$lib/plugins/latex';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { detailsPlugin, DETAILS } from '$lib/plugins/details';
import { arbPluginGfmDoc, arbPluginInlineSource, freshOrFixedSeed } from './arbitraries';

/**
 * G2.1 over the plugin grammar. A registered opener changes which bytes the parser claims
 * and a rung changes which bytes the scanner claims, so this is not the marquee property
 * with more input: it is a different parser under test.
 *
 * Registries are register-once, so the plugins install ONCE for the file, and the reset
 * afterwards stops a rung leaking into this worker's bare-grammar lanes.
 */

const PARAMS = { numRuns: 1000, seed: freshOrFixedSeed(424242) } as const;

function roundTrips(source: string): boolean {
	return serialize(parse(source)) === source;
}

beforeAll(() => {
	resetPluginPlatformForTests();
	// The parser never renders, so a no-op renderer satisfies latex's required option.
	installPlugins([
		footnotesPlugin(),
		emojiPlugin(),
		latexPlugin({ renderer: () => ({ dom: document.createElement('span') }) }),
		admonitionsPlugin(),
		detailsPlugin()
	]);
});

afterAll(() => resetPluginPlatformForTests());

describe('G2.1 round-trip with the bundled plugins installed', () => {
	it('installed the openers this lane exists to cover', () => {
		// Without this the lane passes with every install silently failed: the bare grammar
		// round-trips these bytes as prose.
		for (const kind of [FOOTNOTE_DEF_KIND, MATH_BLOCK, DETAILS, 'admonition', 'githubAlert']) {
			expect(isBlockKindRegistered(kind), `plugin kind not registered: ${kind}`).toBe(true);
		}
	});

	it('serialize(parse(s)) === s over plugin block syntax', () => {
		fc.assert(fc.property(arbPluginGfmDoc, roundTrips), PARAMS);
	});

	it('serialize(parse(s)) === s over plugin inline syntax', () => {
		fc.assert(
			fc.property(arbPluginInlineSource, (source) => roundTrips(source + '\n')),
			PARAMS
		);
	});

	// The malformed arms carry the weight: an opener that declines must leave the bytes it
	// refused exactly as authored.
	it('round-trips openers that decline or never close', () => {
		for (const source of [
			'$$\nx = 1\n',
			':::\n',
			':::unknown-name\ninner\n',
			'> [!BOGUS]\nbody\n',
			'[^]: empty label\n',
			'[^1]: def\n[^1]: duplicate\n',
			':::note\n:::\n:::\n',
			'$$\n$$\n$$\n'
		]) {
			expect(serialize(parse(source)), JSON.stringify(source)).toBe(source);
		}
	});
});
