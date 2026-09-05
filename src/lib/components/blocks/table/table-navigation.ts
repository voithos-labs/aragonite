// Pure: no DOM, no Svelte. Null means "no cell that way" — what the caller does with
// the edge (exit, append a row) is the plan's decision, not this module's.

export interface CellCoord {
	rowIdx: number;
	colIdx: number;
}

export function nextCell(pos: CellCoord, columnCount: number, rowCount: number): CellCoord | null {
	if (pos.colIdx < columnCount - 1) return { rowIdx: pos.rowIdx, colIdx: pos.colIdx + 1 };
	if (pos.rowIdx < rowCount - 1) return { rowIdx: pos.rowIdx + 1, colIdx: 0 };
	return null;
}

export function prevCell(pos: CellCoord, columnCount: number): CellCoord | null {
	if (pos.colIdx > 0) return { rowIdx: pos.rowIdx, colIdx: pos.colIdx - 1 };
	if (pos.rowIdx > 0) return { rowIdx: pos.rowIdx - 1, colIdx: columnCount - 1 };
	return null;
}

export function cellAbove(pos: CellCoord): CellCoord | null {
	return pos.rowIdx === 0 ? null : { rowIdx: pos.rowIdx - 1, colIdx: pos.colIdx };
}

export function cellBelow(pos: CellCoord, rowCount: number): CellCoord | null {
	return pos.rowIdx === rowCount - 1 ? null : { rowIdx: pos.rowIdx + 1, colIdx: pos.colIdx };
}
