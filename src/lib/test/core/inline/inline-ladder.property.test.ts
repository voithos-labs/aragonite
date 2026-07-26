import { afterEach, describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { scanInline } from '../../../core/inline/scan';
import { INLINE_PRIORITIES, registerInlineSyntax } from '../../../core/inline/scan/plugin-syntax';
import { resetPluginPlatformForTests } from '$lib/testing';
import { arbInlineSource, freshOrFixedSeed } from '../../invariants/arbitraries';

// Footnote-, directive- and embed-shaped tokens interleaved with adversarial inline
// content, so the `[^` prefix-match, bare-`:` and `![[` decline paths are actually
// exercised — arbInlineSource alone rarely emits `[^` (culture.md: a generator
// that can't produce the bug class proves nothing about it). The `!` rows are not
// `[^` wearing a different prefix: a registered `!` rung defeats the fast bail on
// ordinary prose, so `!`-bearing sources take the full scan loop where they used to
// short-circuit to one text node — a path the `[^` rung never reaches, since `[` was
// always scan-visible.
const ladderToken = fc.constantFrom(
	'[^1]',
	'[^',
	'[^note]',
	':',
	'::',
	':smile:',
	'[^x]tail',
	'!',
	'![[',
	'![[a.png]]',
	'![[a]](u)'
);
const arbLadderSource = fc
	.tuple(arbInlineSource, ladderToken, arbInlineSource)
	.map(([before, token, after]) => before + token + after);

const PARAMS = { numRuns: 1000, seed: freshOrFixedSeed(717171) } as const;

afterEach(() => resetPluginPlatformForTests());

describe('inline ladder — all-decline recognizers leave scanInline byte-identical', () => {
	it('bare-`:`, `[^`-prefix and `![[`-prefix decliners never perturb the scan output', () => {
		fc.assert(
			fc.property(arbLadderSource, (source) => {
				resetPluginPlatformForTests();
				const clean = scanInline(source, 0, source.length);
				registerInlineSyntax(':', () => null);
				registerInlineSyntax('[', () => null, {
					prefix: '[^',
					priority: INLINE_PRIORITIES.prefixOverride
				});
				registerInlineSyntax('!', () => null, {
					prefix: '![[',
					priority: INLINE_PRIORITIES.prefixOverride
				});
				expect(scanInline(source, 0, source.length)).toEqual(clean);
			}),
			PARAMS
		);
	});
});
