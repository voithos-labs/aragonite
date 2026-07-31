/**
 * Which cells of one table a measurement request covers: a live intra-table
 * rectangle, or a plain `[start, end)` run of row-major cell indices. The rectangle
 * wins only when it belongs to THIS table.
 */

import { SELECTION_END } from '../../../block-component';
import { cellRowCol } from '../../../cursor/coordinate-spaces';
import { pathsEqual } from '../../../selection/path-math';
import type { IntraTableRect } from './cell-clipboard';

export interface CellCoord {
	rowIdx: number;
	colIdx: number;
}

export interface SelectedCellsInput {
	/** The live rectangle from anywhere in the document, or null. */
	rect: IntraTableRect | null;
	/** This table's doc path — the owner check against `rect.tablePath`. */
	myPath: readonly number[];
	start: number;
	/** `SELECTION_END` means "through the last cell". */
	end: number;
	rowCount: number;
	columnCount: number;
}

export function selectedCells(input: SelectedCellsInput): CellCoord[] {
	const { rect, myPath, columnCount, rowCount } = input;
	if (rect && pathsEqual(rect.tablePath, myPath)) {
		return rectangleCells(rect, columnCount);
	}

	const cellCount = rowCount * columnCount;
	const end = input.end === SELECTION_END ? cellCount : Math.min(input.end, cellCount);
	const cells: CellCoord[] = [];
	for (let i = Math.max(0, input.start); i < end; i++) cells.push(coordOf(i, columnCount));
	return cells;
}

function rectangleCells(rect: IntraTableRect, columnCount: number): CellCoord[] {
	const a = coordOf(rect.anchorCellIdx, columnCount);
	const b = coordOf(rect.focusCellIdx, columnCount);
	const cells: CellCoord[] = [];
	for (let r = Math.min(a.rowIdx, b.rowIdx); r <= Math.max(a.rowIdx, b.rowIdx); r++) {
		for (let c = Math.min(a.colIdx, b.colIdx); c <= Math.max(a.colIdx, b.colIdx); c++) {
			cells.push({ rowIdx: r, colIdx: c });
		}
	}
	return cells;
}

function coordOf(cellIdx: number, columnCount: number): CellCoord {
	const { row, col } = cellRowCol(cellIdx, columnCount);
	return { rowIdx: row, colIdx: col };
}
