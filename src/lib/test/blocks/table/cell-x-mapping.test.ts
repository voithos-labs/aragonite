import { describe, it, expect } from 'vitest';
import { columnNearestX } from '../../../components/blocks/table/cell-x-mapping';

describe('columnNearestX', () => {
	const rects: { left: number; right: number }[] = [
		{ left: 0, right: 100 },
		{ left: 100, right: 200 },
		{ left: 200, right: 300 }
	];

	it('picks the column whose horizontal range contains x', () => {
		expect(columnNearestX(50, rects)).toBe(0);
		expect(columnNearestX(150, rects)).toBe(1);
		expect(columnNearestX(250, rects)).toBe(2);
	});

	it('clamps to first column for x left of the table', () => {
		expect(columnNearestX(-50, rects)).toBe(0);
	});

	it('clamps to last column for x past the table', () => {
		expect(columnNearestX(400, rects)).toBe(2);
	});

	it('falls back to nearest by center when x is between columns (boundary cases)', () => {
		// Exactly at the boundary between columns 0 and 1: x=100 → column 1 (range [100, 200) contains 100).
		expect(columnNearestX(100, rects)).toBe(1);
	});
});
