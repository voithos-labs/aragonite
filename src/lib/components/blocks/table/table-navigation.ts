// Pure: no DOM, no Svelte — caller wires sentinels to focus/exit/insert behavior.

export interface CellCoord {
	rowIdx: number;
	colIdx: number;
}

export type CellMove =
	| { kind: 'cell'; rowIdx: number; colIdx: number }
	| { kind: 'create-row' }
	| { kind: 'exit-up' }
	| { kind: 'exit-down' };

export function nextCell(pos: CellCoord, columnCount: number, rowCount: number): CellMove {
	if (pos.colIdx < columnCount - 1) {
		return { kind: 'cell', rowIdx: pos.rowIdx, colIdx: pos.colIdx + 1 };
	}
	if (pos.rowIdx < rowCount - 1) {
		return { kind: 'cell', rowIdx: pos.rowIdx + 1, colIdx: 0 };
	}
	return { kind: 'create-row' };
}

export function prevCell(pos: CellCoord, columnCount: number): CellMove {
	if (pos.colIdx > 0) {
		return { kind: 'cell', rowIdx: pos.rowIdx, colIdx: pos.colIdx - 1 };
	}
	if (pos.rowIdx > 0) {
		return { kind: 'cell', rowIdx: pos.rowIdx - 1, colIdx: columnCount - 1 };
	}
	return { kind: 'exit-up' };
}

export function cellAbove(pos: CellCoord): CellMove {
	if (pos.rowIdx === 0) return { kind: 'exit-up' };
	return { kind: 'cell', rowIdx: pos.rowIdx - 1, colIdx: pos.colIdx };
}

export function cellBelow(pos: CellCoord, rowCount: number): CellMove {
	if (pos.rowIdx === rowCount - 1) return { kind: 'exit-down' };
	return { kind: 'cell', rowIdx: pos.rowIdx + 1, colIdx: pos.colIdx };
}
