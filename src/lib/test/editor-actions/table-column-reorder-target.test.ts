import { describe, it, expect } from 'vitest';
import { tableColumnReorderTarget } from '$lib/editor-actions/table-context';

// colCount is the FULL column count; columns have no fixed header, so every index is a
// valid source and target. A null result means no-op, so a boundary press pushes no undo entry.
describe('tableColumnReorderTarget', () => {
	it('returns the adjacent index within bounds (no fixed header column)', () => {
		expect(tableColumnReorderTarget(1, 1, 3)).toBe(2);
		expect(tableColumnReorderTarget(1, -1, 3)).toBe(0);
		expect(tableColumnReorderTarget(0, 1, 3)).toBe(1);
	});

	it('returns null at the boundaries', () => {
		expect(tableColumnReorderTarget(0, -1, 3)).toBeNull();
		expect(tableColumnReorderTarget(2, 1, 3)).toBeNull();
	});
});
