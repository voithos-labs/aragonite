import { describe, it, expect, vi } from 'vitest';

import { createScanIndex } from '$lib/scan-index';

function digitPositions(raw: string): Int32Array {
	const positions: number[] = [];
	for (let i = 0; i < raw.length; i++) {
		if (raw[i] >= '0' && raw[i] <= '9') positions.push(i);
	}
	return Int32Array.from(positions);
}

describe('createScanIndex lookup', () => {
	const lookup = createScanIndex(digitPositions);
	const raw = 'a1b23c'; // candidates at 1, 3, 4

	it('is inclusive at-or-after: an exact hit returns itself', () => {
		expect(lookup(raw, 1)).toBe(1);
		expect(lookup(raw, 4)).toBe(4);
	});

	it('skips from a gap to the next candidate, and from 0 to the first', () => {
		expect(lookup(raw, 2)).toBe(3);
		expect(lookup(raw, 0)).toBe(1);
	});

	it('returns -1 past the last candidate and on a candidate-free raw', () => {
		expect(lookup(raw, 5)).toBe(-1);
		expect(lookup('abc', 0)).toBe(-1);
	});
});

describe('createScanIndex memoization', () => {
	it('collects once per raw across consultations', () => {
		const collect = vi.fn(digitPositions);
		const lookup = createScanIndex(collect);

		lookup('a1b2', 0);
		lookup('a1b2', 2);
		lookup('a1b2', 9);

		expect(collect).toHaveBeenCalledTimes(1);
	});

	// Cap 2 is the load-bearing bound: recognition consulting two blocks alternately must
	// not thrash the index, while old blocks must not accumulate. The LRU mechanics are
	// pinned once on the shared primitive in bounded-memo.test.ts; this pins the wiring.
	it('holds two raws at once; a third evicts one', () => {
		const collect = vi.fn(digitPositions);
		const lookup = createScanIndex(collect);

		lookup('a1', 0);
		lookup('b2', 0);
		lookup('a1', 0);
		lookup('b2', 0);
		expect(collect).toHaveBeenCalledTimes(2);

		lookup('c3', 0); // past the cap
		lookup('a1', 0);
		expect(collect).toHaveBeenCalledTimes(4);
	});
});
