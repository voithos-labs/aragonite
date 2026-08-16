import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { activateDirectiveGrammar } from '$lib/core/directive/activate';
import { measureScanGrowth, BOUNDED_GROWTH_CEILING } from '../../harness/scan-growth';

activateDirectiveGrammar(); // before any parse

const parseOnly = (source: string) => void parse(source);

// A flood of unclosed container openers can forward-scan to EOF per opener — O(n^2). Priced as
// the N-vs-4N ratio, so the bound is the machine-independent one.

describe('directive container-opener bounds (ADV-2)', () => {
	it('an unclosed-opener flood parses within a bounded growth ratio and round-trips', () => {
		const { times, ratio } = measureScanGrowth(parseOnly, ':::a\n', [32, 128]);
		expect(ratio, `32KB=${times[0].toFixed(1)}ms 128KB=${times[1].toFixed(1)}ms`).toBeLessThan(
			BOUNDED_GROWTH_CEILING
		);

		const source = ':::a\n'.repeat(25_000);
		expect(serialize(parse(source))).toBe(source);
	}, 300_000);
});

// One rung below the flood above: when every closer-shaped line is SHORTER than its
// openers the lookup never matches, so an unbounded walk revisits every closer per opener.
describe('directive closer lookup bounds', () => {
	it('stays bounded when no closer is long enough to close any opener', () => {
		const { ratio } = measureScanGrowth(parseOnly, ':::a\n:\n', [64, 256]);
		expect(ratio).toBeLessThan(BOUNDED_GROWTH_CEILING);
	}, 120_000);

	it('round-trips the unclosable shape byte-for-byte', () => {
		const source = ':::a\n:\n'.repeat(500);
		expect(serialize(parse(source))).toBe(source);
	});
});
