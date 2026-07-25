import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { activateDirectiveGrammar } from '$lib/core/directive/activate';
import { measureScanGrowth, BOUNDED_GROWTH_CEILING } from '../../harness/scan-growth';

activateDirectiveGrammar(); // register the ::: opener before parsing

// A flood of unclosed container openers once forward-scanned to EOF per opener —
// O(n^2). The closer positions are indexed once per line array, so each opener's
// lookup is bounded. Generous wall-time bound: fails on a quadratic regression
// (>10s at this size) without flaking on slow machines.

describe('directive container-opener bounds (ADV-2)', () => {
	it('an unclosed-opener flood parses in bounded time and round-trips', () => {
		const source = ':::a\n'.repeat(25_000);
		const started = performance.now();
		const doc = parse(source);
		expect(performance.now() - started).toBeLessThan(2000);
		expect(serialize(doc)).toBe(source);
	}, 60_000);
});

// The closer index bounded the flood above, but the LOOKUP into it still walked
// forward from the first later closer until it found a colon run long enough. A
// document whose closer-shaped lines are all SHORTER than its openers never finds
// one, so every opener walked every closer — quadratic again, one rung down.
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
