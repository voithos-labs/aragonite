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
		expect(m.offsetOf(4)).toBe(100); // offset past the last index == total
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
		expect(m.indexAtOffset(99999)).toBe(3); // clamps to last
	});

	it('handles an empty model', () => {
		const m = new HeightModel([]);
		expect(m.size).toBe(0);
		expect(m.total()).toBe(0);
		expect(m.indexAtOffset(50)).toBe(0);
	});
});
