import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { activateDirectiveGrammar } from '$lib/core/directive/activate';
import { measureScanGrowth, BOUNDED_GROWTH_CEILING } from '../../harness/scan-growth';

activateDirectiveGrammar(); // before any parse

// A flood of unclosed container openers can forward-scan to EOF per opener — O(n^2). The
// wall-time bound is generous: it fails on a quadratic regression without flaking.

describe('directive container-opener bounds (ADV-2)', () => {
	it('an unclosed-opener flood parses in bounded time and round-trips', () => {
		const source = ':::a\n'.repeat(25_000);
		const started = performance.now();
		const doc = parse(source);
		expect(performance.now() - started).toBeLessThan(2000);
		expect(serialize(doc)).toBe(source);
	}, 60_000);
});

// One rung below the flood above: when every closer-shaped line is SHORTER than its
// openers the lookup never matches, so an unbounded walk revisits every closer per opener.
describe('directive closer lookup bounds', () => {
	it('stays bounded when no closer is long enough to close any opener', () => {
		const { ratio } = measureScanGrowth((source) => void parse(source), ':::a\n:\n', [64, 256]);
		expect(ratio).toBeLessThan(BOUNDED_GROWTH_CEILING);
	}, 120_000);

	it('round-trips the unclosable shape byte-for-byte', () => {
		const source = ':::a\n:\n'.repeat(500);
		expect(serialize(parse(source))).toBe(source);
	});
});
