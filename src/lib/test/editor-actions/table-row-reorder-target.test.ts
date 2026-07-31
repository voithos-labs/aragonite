import { describe, it, expect } from 'vitest';
import { tableRowReorderTarget } from '$lib/editor-actions/table-context';

// rowCount is the FULL row count: the header is fixed at index 0 and body rows occupy
// 1..rowCount-1. A null result means no-op, so a boundary press pushes no undo entry.
describe('tableRowReorderTarget', () => {
	it('moves an interior body row in the requested direction', () => {
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
		expect(tableRowReorderTarget(1, -1, 4)).toBeNull();
		expect(tableRowReorderTarget(3, 1, 4)).toBeNull();
	});

	it('no-ops when only one body row exists (nothing to swap with)', () => {
		expect(tableRowReorderTarget(1, 1, 2)).toBeNull();
		expect(tableRowReorderTarget(1, -1, 2)).toBeNull();
	});
});
