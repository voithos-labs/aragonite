/**
 * Which cells of one table a measurement request covers: a live rectangle of cells, or a plain
 * `[start, end)` run of row-major cell indices. The rectangle wins only when it belongs to this
 * table.
 */

import { SELECTION_END } from '../../../block-component';
import { cellRowCol, type CellRect } from '../../../cursor/coordinate-spaces';
import { pathsEqual } from '../../../selection/path-math';
import type { GridCoverage } from '../../../selection/range-coverage';
import type { CellCoord } from './table-navigation';

export interface SelectedCellsInput {
	/** The live rectangle's coverage from anywhere in the document, or null. */
	grid: GridCoverage | null;
	/** This table's document path, checked against `grid.path`. */
	myPath: readonly number[];
	start: number;
	/** `SELECTION_END` means "through the last cell". */
	end: number;
	rowCount: number;
	columnCount: number;
}

export function selectedCells(input: SelectedCellsInput): CellCoord[] {
	const { grid, myPath, columnCount, rowCount } = input;
	if (grid && pathsEqual(grid.path, myPath)) return rectangleCells(grid.rect);

	const cellCount = rowCount * columnCount;
	const end = input.end === SELECTION_END ? cellCount : Math.min(input.end, cellCount);
	const cells: CellCoord[] = [];
	for (let i = Math.max(0, input.start); i < end; i++) cells.push(coordOf(i, columnCount));
	return cells;
}

function rectangleCells({ top, left, rows, cols }: CellRect): CellCoord[] {
	const cells: CellCoord[] = [];
	for (let r = top; r < top + rows; r++) {
		for (let c = left; c < left + cols; c++) cells.push({ rowIdx: r, colIdx: c });
	}
	return cells;
}

function coordOf(cellIdx: number, columnCount: number): CellCoord {
	const { row, col } = cellRowCol(cellIdx, columnCount);
	return { rowIdx: row, colIdx: col };
}
