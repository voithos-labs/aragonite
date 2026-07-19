import { describe, it, expect } from 'vitest';
import { canDeleteRow, canDeleteColumn } from '$lib/tree-operations/table-mutations';

// rowCount is the FULL row count (header at index 0 + body rows). A header
// delete promotes the next row, so it only needs a second row; a body delete
// needs a second body row, else a header-only table would be left.
describe('canDeleteRow', () => {
	it('refuses a header-only table (nothing left to promote)', () => {
		expect(canDeleteRow(0, 1)).toBe(false);
	});

	it('allows deleting the header when a body row exists to promote', () => {
		expect(canDeleteRow(0, 2)).toBe(true);
	});

	it('refuses the only body row, allows it once a second body row exists', () => {
		expect(canDeleteRow(1, 2)).toBe(false);
		expect(canDeleteRow(1, 3)).toBe(true);
	});
});

describe('canDeleteColumn', () => {
	it('refuses the last column, allows it above one', () => {
		expect(canDeleteColumn(1)).toBe(false);
		expect(canDeleteColumn(2)).toBe(true);
	});
});
