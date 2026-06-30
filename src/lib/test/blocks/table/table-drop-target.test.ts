import { describe, it, expect } from 'vitest';
import { rowDropIndex, columnDropIndex } from '../../../components/blocks/table/table-drop-target';

describe('drop-target index (nearest gap, insert semantics)', () => {
	it('returns the gap index nearest the pointer', () => {
		expect(rowDropIndex(5, [0, 20, 40, 60])).toBe(0); // near top edge
		expect(rowDropIndex(25, [0, 20, 40, 60])).toBe(1); // nearest the 20 boundary
		expect(rowDropIndex(38, [0, 20, 40, 60])).toBe(2); // nearest the 40 boundary
		expect(columnDropIndex(70, [0, 40, 80, 120])).toBe(2); // nearest the 80 boundary
	});

	it('clamps to the ends', () => {
		expect(rowDropIndex(-100, [0, 20, 40, 60])).toBe(0);
		expect(rowDropIndex(9999, [0, 20, 40, 60])).toBe(3);
	});

	it('handles a single boundary', () => {
		expect(rowDropIndex(5, [0])).toBe(0);
	});

	it('breaks an exact tie toward the lower gap index', () => {
		expect(rowDropIndex(10, [0, 20])).toBe(0);
		expect(columnDropIndex(20, [0, 40])).toBe(0);
	});
});
