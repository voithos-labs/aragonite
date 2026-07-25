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
 * G2.1 over the plugin grammar. The marquee round-trip invariant runs against
 * the built-in grammar alone, so no plugin opener's return and no inline rung
 * has ever been under property coverage — the surface where a third-party
 * opener bug lives, and the newest code in the repo.
 *
 * A registered opener changes which bytes the parser claims and a registered
 * rung changes which bytes the scanner claims, so this is not the built-in
 * property with more input: it is a different parser under test.
 *
 * Isolation: registries are register-once/throw-on-duplicate, so the plugins are
 * installed ONCE for the file rather than per case, and the platform is reset
 * afterwards so a worker running this file alongside the bare-grammar lanes
 * cannot leak a rung into them.
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
		// Without this the lane would still pass with every install silently failed —
		// the bare grammar round-trips these bytes as prose.
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

	// The malformed arms carry the weight: an opener that declines must leave the
	// bytes it refused exactly as authored, and a decline is where the 0.9.33-0.9.35
	// rungs most recently went wrong.
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
