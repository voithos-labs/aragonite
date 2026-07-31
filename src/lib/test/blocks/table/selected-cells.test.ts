import { describe, it, expect } from 'vitest';
import { SELECTION_END } from '$lib/block-component';
import { selectedCells } from '$lib/components/blocks/table/selected-cells';
import type { IntraTableRect } from '$lib/components/blocks/table/cell-clipboard';

// A 3×3 grid; cell indices are row-major.
const GRID = { rowCount: 3, columnCount: 3 };

/** Rows 1–2 × columns 0–1 of the table at `tablePath`. */
function rectAt(tablePath: number[]): IntraTableRect {
	return { tablePath, anchorCellIdx: 3, focusCellIdx: 7 };
}

describe('selectedCells', () => {
	it('reads a plain index range when no rectangle is live', () => {
		expect(selectedCells({ rect: null, myPath: [0], start: 0, end: 2, ...GRID })).toEqual([
			{ rowIdx: 0, colIdx: 0 },
			{ rowIdx: 0, colIdx: 1 }
		]);
	});

	it('treats SELECTION_END as the last cell', () => {
		const cells = selectedCells({ rect: null, myPath: [0], start: 7, end: SELECTION_END, ...GRID });
		expect(cells).toEqual([
			{ rowIdx: 2, colIdx: 1 },
			{ rowIdx: 2, colIdx: 2 }
		]);
	});

	it('clamps a range that runs past the grid', () => {
		const cells = selectedCells({ rect: null, myPath: [0], start: -4, end: 99, ...GRID });
		expect(cells).toHaveLength(9);
	});

	it('paints this table’s own rectangle instead of the requested range', () => {
		const cells = selectedCells({ rect: rectAt([0]), myPath: [0], start: 0, end: 1, ...GRID });
		expect(cells).toEqual([
			{ rowIdx: 1, colIdx: 0 },
			{ rowIdx: 1, colIdx: 1 },
			{ rowIdx: 2, colIdx: 0 },
			{ rowIdx: 2, colIdx: 1 }
		]);
	});

	// `rangeRects` is public API. With two tables on screen, a rectangle dragged in table A must not
	// hand table B its own cells at A's coordinates.
	it('ignores a rectangle that belongs to another table', () => {
		const cells = selectedCells({ rect: rectAt([5]), myPath: [0], start: 0, end: 1, ...GRID });
		expect(cells).toEqual([{ rowIdx: 0, colIdx: 0 }]);
	});

	it('ignores a rectangle in a nested table that shares this table’s path prefix', () => {
		const cells = selectedCells({
			rect: rectAt([0, 1, 2]),
			myPath: [0],
			start: 0,
			end: 1,
			...GRID
		});
		expect(cells).toEqual([{ rowIdx: 0, colIdx: 0 }]);
	});
});
