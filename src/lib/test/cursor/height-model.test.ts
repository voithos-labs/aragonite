import { describe, it, expect } from 'vitest';
import { HeightModel } from '../../cursor/height-model';

describe('HeightModel', () => {
	it('reports total and per-index offsets', () => {
		const m = new HeightModel([10, 20, 30, 40]);
		expect(m.size).toBe(4);
		expect(m.total()).toBe(100);
		expect(m.offsetOf(0)).toBe(0);
		expect(m.offsetOf(1)).toBe(10);
		expect(m.offsetOf(2)).toBe(30);
		expect(m.offsetOf(4)).toBe(100);
	});

	it('updates one height in place and reflects it in offsets and total', () => {
		const m = new HeightModel([10, 20, 30]);
		m.setHeight(1, 25);
		expect(m.heightOf(1)).toBe(25);
		expect(m.offsetOf(2)).toBe(35);
		expect(m.total()).toBe(65);
	});

	it('finds the index whose row contains a pixel offset', () => {
		const m = new HeightModel([10, 20, 30, 40]); // tops at 0,10,30,60
		expect(m.indexAtOffset(0)).toBe(0);
		expect(m.indexAtOffset(9)).toBe(0);
		expect(m.indexAtOffset(10)).toBe(1);
		expect(m.indexAtOffset(59)).toBe(2);
		expect(m.indexAtOffset(60)).toBe(3);
		expect(m.indexAtOffset(99999)).toBe(3);
	});

	it('handles an empty model', () => {
		const m = new HeightModel([]);
		expect(m.size).toBe(0);
		expect(m.total()).toBe(0);
		expect(m.indexAtOffset(50)).toBe(0);
	});

	// The lower-bound seed `1 << floor(log2(count))` is only correct when it
	// degrades for non-power-of-two counts — exercise count 5 and 7 directly.
	it('locates offsets on non-power-of-two counts', () => {
		const five = new HeightModel([10, 20, 30, 40, 50]); // tops 0,10,30,60,100; total 150
		expect(five.indexAtOffset(0)).toBe(0);
		expect(five.indexAtOffset(29)).toBe(1);
		expect(five.indexAtOffset(30)).toBe(2);
		expect(five.indexAtOffset(99)).toBe(3);
		expect(five.indexAtOffset(100)).toBe(4);
		expect(five.indexAtOffset(150)).toBe(4);
		expect(five.indexAtOffset(99999)).toBe(4);

		const seven = new HeightModel([1, 1, 1, 1, 1, 1, 1]); // tops 0..6; total 7
		expect(seven.indexAtOffset(0)).toBe(0);
		expect(seven.indexAtOffset(3)).toBe(3);
		expect(seven.indexAtOffset(6)).toBe(6);
		expect(seven.indexAtOffset(7)).toBe(6);
	});

	// Zero-height entries make consecutive tops tie; pin that the search lands on
	// the last tied index so a future refactor can't silently flip the contract.
	it('lands on the last index when zero-height entries tie offsets', () => {
		const m = new HeightModel([5, 0, 0, 0]); // tops 0,5,5,5; total 5
		expect(m.indexAtOffset(4)).toBe(0);
		expect(m.indexAtOffset(5)).toBe(3);
	});

	// VR-9: out-of-range writes/reads must not poison the Fenwick tree — a stale height recorded
	// at i === count, NaN offsets past it, and a bump that never terminates on a negative index.
	it('ignores a setHeight at or past the count instead of recording a stale height', () => {
		const m = new HeightModel([10, 20, 30]); // count 3
		m.setHeight(3, 50);
		expect(m.heightOf(3)).toBe(0); // unguarded: returns 50
		expect(m.total()).toBe(60);
	});

	it('ignores a negative setHeight index instead of looping forever', () => {
		const m = new HeightModel([10, 20, 30]);
		m.setHeight(-1, 50); // unguarded: bump(-1) never terminates
		expect(m.total()).toBe(60);
	});

	it('clamps offsetOf past the count to total instead of returning NaN', () => {
		const m = new HeightModel([10, 20, 30]); // total 60
		expect(m.offsetOf(3)).toBe(60);
		expect(m.offsetOf(4)).toBe(60); // unguarded: NaN
		expect(Number.isFinite(m.offsetOf(99))).toBe(true);
	});
});
