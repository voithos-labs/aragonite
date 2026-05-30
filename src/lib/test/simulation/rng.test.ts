import { describe, it, expect } from 'vitest';
import { makeRng } from '$lib/editor/e2e/simulation/rng';

describe('makeRng', () => {
	it('is deterministic for a seed', () => {
		const a = makeRng(42);
		const b = makeRng(42);
		const seqA = Array.from({ length: 20 }, () => a.int(0, 1000));
		const seqB = Array.from({ length: 20 }, () => b.int(0, 1000));
		expect(seqA).toEqual(seqB);
	});

	it('differs across seeds', () => {
		const a = makeRng(1);
		const b = makeRng(2);
		expect(a.int(0, 1e9)).not.toEqual(b.int(0, 1e9));
	});

	it('int stays in [min, max)', () => {
		const r = makeRng(7);
		for (let i = 0; i < 500; i++) {
			const n = r.int(3, 9);
			expect(n).toBeGreaterThanOrEqual(3);
			expect(n).toBeLessThan(9);
		}
	});

	it('chance(0) is always false and chance(1) is always true', () => {
		const r = makeRng(11);
		for (let i = 0; i < 100; i++) {
			expect(r.chance(0)).toBe(false);
			expect(r.chance(1)).toBe(true);
		}
	});

	it('pick draws from the given items', () => {
		const r = makeRng(3);
		const items = ['a', 'b', 'c'] as const;
		for (let i = 0; i < 100; i++) {
			expect(items).toContain(r.pick(items));
		}
	});

	it('weightedPick never returns a weight-0 item', () => {
		const r = makeRng(7);
		for (let i = 0; i < 200; i++) {
			const v = r.weightedPick([
				{ value: 'a', weight: 1 },
				{ value: 'z', weight: 0 }
			]);
			expect(v).toBe('a');
		}
	});

	it('weightedPick honors relative weights', () => {
		const r = makeRng(99);
		let heavy = 0;
		for (let i = 0; i < 1000; i++) {
			const v = r.weightedPick([
				{ value: 'heavy', weight: 9 },
				{ value: 'light', weight: 1 }
			]);
			if (v === 'heavy') heavy++;
		}
		expect(heavy).toBeGreaterThan(800);
		expect(heavy).toBeLessThan(950);
	});
});
