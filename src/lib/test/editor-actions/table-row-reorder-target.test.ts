import { describe, it, expect } from 'vitest';
import { tableRowReorderTarget } from '$lib/editor-actions/table-context';

// rowCount is the FULL row count (header at index 0 + body rows). Body rows
// occupy indices 1..rowCount-1; the header is fixed. A null result means no-op
// (skips the commit, so a boundary press pushes no undo entry).
describe('tableRowReorderTarget', () => {
	it('moves an interior body row in the requested direction', () => {
		// 4 rows: header + 3 body (indices 1,2,3).
		expect(tableRowReorderTarget(1, 1, 4)).toBe(2);
		expect(tableRowReorderTarget(2, 1, 4)).toBe(3);
		expect(tableRowReorderTarget(2, -1, 4)).toBe(1);
		expect(tableRowReorderTarget(3, -1, 4)).toBe(2);
	});

	it('no-ops on the header row in either direction', () => {
		expect(tableRowReorderTarget(0, 1, 4)).toBeNull();
		expect(tableRowReorderTarget(0, -1, 4)).toBeNull();
	});

	it('no-ops at the body boundaries (cannot cross the header or pass the last row)', () => {
		// First body row can't move up into the header slot.
		expect(tableRowReorderTarget(1, -1, 4)).toBeNull();
		// Last body row can't move down past itself.
		expect(tableRowReorderTarget(3, 1, 4)).toBeNull();
	});

	it('no-ops when only one body row exists (nothing to swap with)', () => {
		// 2 rows: header + 1 body (index 1).
		expect(tableRowReorderTarget(1, 1, 2)).toBeNull();
		expect(tableRowReorderTarget(1, -1, 2)).toBeNull();
	});
});
