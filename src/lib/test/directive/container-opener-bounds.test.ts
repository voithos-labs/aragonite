import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { activateDirectiveGrammar } from '$lib/core/directive/activate';

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
