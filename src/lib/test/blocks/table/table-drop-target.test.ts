import { describe, it, expect } from 'vitest';
import { dropGapIndex } from '../../../components/blocks/table/table-drop-target';

describe('drop-target index (nearest gap, insert semantics)', () => {
	it('returns the gap index nearest the pointer', () => {
		expect(dropGapIndex(5, [0, 20, 40, 60])).toBe(0); // near top edge
		expect(dropGapIndex(25, [0, 20, 40, 60])).toBe(1); // nearest the 20 boundary
		expect(dropGapIndex(38, [0, 20, 40, 60])).toBe(2); // nearest the 40 boundary
		expect(dropGapIndex(70, [0, 40, 80, 120])).toBe(2); // nearest the 80 boundary
	});

	it('clamps to the ends', () => {
		expect(dropGapIndex(-100, [0, 20, 40, 60])).toBe(0);
		expect(dropGapIndex(9999, [0, 20, 40, 60])).toBe(3);
	});

	it('handles a single boundary', () => {
		expect(dropGapIndex(5, [0])).toBe(0);
	});

	it('breaks an exact tie toward the lower gap index', () => {
		expect(dropGapIndex(10, [0, 20])).toBe(0);
		expect(dropGapIndex(20, [0, 40])).toBe(0);
	});
});
