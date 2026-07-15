import { describe, it, expect } from 'vitest';
import { columnNearestX } from '../../../components/blocks/table/cell-x-mapping';
import { asEditorX } from '../../../cursor/coordinate-spaces';

describe('columnNearestX', () => {
	const rects: { left: number; right: number }[] = [
		{ left: 0, right: 100 },
		{ left: 100, right: 200 },
		{ left: 200, right: 300 }
	];
	const at = (x: number): number => columnNearestX(asEditorX(x), rects);

	it('picks the column whose horizontal range contains x', () => {
		expect(at(50)).toBe(0);
		expect(at(150)).toBe(1);
		expect(at(250)).toBe(2);
	});

	it('clamps to first column for x left of the table', () => {
		expect(at(-50)).toBe(0);
	});

	it('clamps to last column for x past the table', () => {
		expect(at(400)).toBe(2);
	});

	it('falls back to nearest by center when x is between columns (boundary cases)', () => {
		// Exactly at the boundary between columns 0 and 1: x=100 → column 1 (range [100, 200) contains 100).
		expect(at(100)).toBe(1);
	});
});
