import { describe, it, expect } from 'vitest';
import { classifyTableSelectionCoverage } from '../../selection/range-delete-table-coverage';

describe('classifyTableSelectionCoverage — 3 columns × 3 rows', () => {
	const cols = 3;
	const rows = 3;

	it('full-table: 0..8 → kind="table"', () => {
		expect(classifyTableSelectionCoverage(0, 8, cols, rows)).toEqual({ kind: 'table' });
	});

	it('full-row at index 0: 0..2 → kind="row", rowIdx=0', () => {
		expect(classifyTableSelectionCoverage(0, 2, cols, rows)).toEqual({ kind: 'row', rowIdx: 0 });
	});

	it('full-row at last index: 6..8 → kind="row", rowIdx=2', () => {
		expect(classifyTableSelectionCoverage(6, 8, cols, rows)).toEqual({ kind: 'row', rowIdx: 2 });
	});

	it('full-row at middle index: 3..5 → kind="row", rowIdx=1', () => {
		expect(classifyTableSelectionCoverage(3, 5, cols, rows)).toEqual({ kind: 'row', rowIdx: 1 });
	});

	it('full-column at index 0: 0..6 → kind="column", colIdx=0', () => {
		expect(classifyTableSelectionCoverage(0, 6, cols, rows)).toEqual({
			kind: 'column',
			colIdx: 0
		});
	});

	it('full-column at last index: 2..8 → kind="column", colIdx=2', () => {
		expect(classifyTableSelectionCoverage(2, 8, cols, rows)).toEqual({
			kind: 'column',
			colIdx: 2
		});
	});

	it('full-column at middle index: 1..7 → kind="column", colIdx=1', () => {
		expect(classifyTableSelectionCoverage(1, 7, cols, rows)).toEqual({
			kind: 'column',
			colIdx: 1
		});
	});

	it('partial row span: 0..1 → kind="cells"', () => {
		expect(classifyTableSelectionCoverage(0, 1, cols, rows)).toEqual({ kind: 'cells' });
	});

	it('partial column span: 0..3 → kind="cells"', () => {
		expect(classifyTableSelectionCoverage(0, 3, cols, rows)).toEqual({ kind: 'cells' });
	});

	it('multi-row rectangular block (not full row, not full column): 0..4 → kind="cells"', () => {
		expect(classifyTableSelectionCoverage(0, 4, cols, rows)).toEqual({ kind: 'cells' });
	});

	it('reversed endpoints (focus before anchor) classify the same as forward', () => {
		expect(classifyTableSelectionCoverage(8, 0, cols, rows)).toEqual({ kind: 'table' });
		expect(classifyTableSelectionCoverage(2, 0, cols, rows)).toEqual({ kind: 'row', rowIdx: 0 });
		expect(classifyTableSelectionCoverage(6, 0, cols, rows)).toEqual({
			kind: 'column',
			colIdx: 0
		});
	});
});

describe('classifyTableSelectionCoverage — degenerate shapes', () => {
	it('single-column table: full-table span beats the equivalent column span', () => {
		// 1 col × 3 rows; cells [0,1,2]
		expect(classifyTableSelectionCoverage(0, 2, 1, 3)).toEqual({ kind: 'table' });
	});

	it('single-row table: full-table span beats the equivalent row span', () => {
		// 3 cols × 1 row; cells [0,1,2]
		expect(classifyTableSelectionCoverage(0, 2, 3, 1)).toEqual({ kind: 'table' });
	});
});
