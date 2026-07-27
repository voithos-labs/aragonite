/**
 * The claim a rung leaves on the node it mints. A rung may mint a BUILT-IN kind
 * over bytes of its own — an `![[cat.png]]` that is an `image` to the whole editor,
 * which is the point of the borrowing. The editor's inverse for a built-in kind
 * emits the built-in grammar, so the scan records who owns the bytes; without the
 * stamp a resize re-serializes the embed as GFM.
 *
 * Both dispatch routes are driven here. `stampClaim` sits inside `tryRungs`, which
 * the pre-switch reserved consultation and the `default` arm both call — structural
 * coverage, but only until someone moves the stamp into one branch, which is why
 * the unreserved trigger gets its own case.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { InlineNode } from '../../../core/nodes';
import { parseInline } from '../../../core/inline';
import {
	__resetInlineSyntaxForTests,
	registerInlineSyntax,
	type InlineSyntaxRecognizer
} from '../../../core/inline/scan/plugin-syntax';

afterEach(() => __resetInlineSyntaxForTests());

// `![[target]]` through the closing pair, image extensions only — the same minimal
// embed stand-in `inline-ladder-bang.test.ts` drives, whose extension gate is what
// declines the `![[a]](u)` overlap.
const recognizeEmbed: InlineSyntaxRecognizer = (raw, pos, end) => {
	if (!raw.startsWith('![[', pos)) return null;
	const close = raw.indexOf(']]', pos + 3);
	if (close < 0 || close + 2 > end) return null;
	if (!/\.(png|jpg|svg)$/.test(raw.slice(pos + 3, close))) return null;
	return { kind: 'wikiEmbed' as InlineNode['kind'], start: pos, end: close + 2 };
};

function registerEmbed(recognizer: InlineSyntaxRecognizer = recognizeEmbed): void {
	registerInlineSyntax('!', recognizer, { prefix: '![[', priority: 40 });
}

describe('a reserved-trigger prefix rung stamps what it claims', () => {
	it('stamps the built-in kind the rung minted', () => {
		// A `![[target]]` that IS an image node rather than merely rendering like one.
		registerEmbed((raw, pos, end) => {
			const embed = recognizeEmbed(raw, pos, end);
			return embed && { ...embed, kind: 'image', alt: 'a.png', url: 'resolved' };
		});
		const raw = '![[a.png]]';
		expect(parseInline(raw, 0, raw.length)[0].syntaxClaim).toMatchObject({ prefix: '![[' });
	});

	// The editor has no grammar for a plugin's own kind, so nothing outside the
	// plugin can re-serialize one and the stamp would have no reader.
	it('leaves the rung’s own kind unstamped', () => {
		registerEmbed();
		const raw = '![[a.png]]';
		expect(parseInline(raw, 0, raw.length)[0].syntaxClaim).toBeUndefined();
	});

	// A built-in node inside the claimed range rewrites into the middle of the rung's
	// bytes, so the stamp reaches descendants on the same rule.
	it('stamps a built-in node nested inside the rung’s own kind', () => {
		registerEmbed((raw, pos, end) => {
			const embed = recognizeEmbed(raw, pos, end);
			return (
				embed && { ...embed, children: [{ kind: 'image', start: pos + 3, end: embed.end - 2 }] }
			);
		});
		const raw = '![[a.png]]';
		const embed = parseInline(raw, 0, raw.length)[0];
		expect(embed.syntaxClaim).toBeUndefined();
		expect(embed.children?.[0].syntaxClaim).toMatchObject({ prefix: '![[' });
	});

	// `![[a]](u)` is a built-in image the rung declines. Nothing claimed it, so the
	// GFM write path still owns those bytes — a stamp here would freeze a plain image
	// the editor is entitled to rewrite.
	it('leaves an image the rung declined unstamped', () => {
		registerEmbed();
		const raw = '![[a]](u)';
		expect(parseInline(raw, 0, raw.length)[0].syntaxClaim).toBeUndefined();
	});
});

// The other half of the dispatch: a bare rung on an unreserved trigger is consulted
// from the switch's `default` arm, a different call site than the prefix rungs above.
describe('a bare unreserved-trigger rung stamps what it claims', () => {
	it('stamps a built-in kind minted from the default arm', () => {
		registerInlineSyntax('@', (raw, pos, end) => {
			const close = raw.indexOf('@', pos + 1);
			if (close < 0 || close + 1 > end) return null;
			return { kind: 'image', start: pos, end: close + 1, alt: 'm', url: 'm.png' };
		});
		const raw = '@m@';
		expect(parseInline(raw, 0, raw.length)[0].syntaxClaim).toMatchObject({ prefix: '@' });
	});
});
