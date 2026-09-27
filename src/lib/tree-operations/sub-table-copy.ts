/**
 * A rectangle of a table's cells as clipboard text: a GFM table of its own, written by the table
 * rebuilder so its rows, padding and line ending are the ones the document's table has.
 */

import type { CstNode, TableAlignment } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { metadataOf } from '../core/nodes';
import { rebuildTableRaw, tableLineEnding } from '../schema/container-rebuilders';

export interface CellPos {
	rowIdx: number;
	colIdx: number;
}

/** The rectangle as a GFM table, its first row the header; one cell is its raw alone. */
export function copyRectangleAsSubTable(table: NodeView, a: CellPos, b: CellPos): string {
	const cellRaws = rectangleCellRaws(table, a, b);
	if (cellRaws.length === 1 && cellRaws[0].length === 1) return cellRaws[0][0];

	const left = Math.min(a.colIdx, b.colIdx);
	const alignments = metadataOf(table, 'table').alignments.slice(left, left + cellRaws[0].length);
	return subTable(cellRaws, alignments, tableLineEnding(table)).raw;
}

/** The raws of the cells between two corners, row by row; a missing cell reads empty. */
export function rectangleCellRaws(table: NodeView, a: CellPos, b: CellPos): string[][] {
	const rows = table.children ?? [];
	const grid: string[][] = [];
	for (let r = Math.min(a.rowIdx, b.rowIdx); r <= Math.max(a.rowIdx, b.rowIdx); r++) {
		const cells = rows[r]?.children ?? [];
		const line: string[] = [];
		for (let c = Math.min(a.colIdx, b.colIdx); c <= Math.max(a.colIdx, b.colIdx); c++) {
			line.push(cells[c]?.raw ?? '');
		}
		grid.push(line);
	}
	return grid;
}

function subTable(cellRaws: string[][], alignments: TableAlignment[], lineEnding: string): CstNode {
	const table: CstNode = {
		kind: 'table',
		leadingTrivia: '',
		// The rebuild reads the line ending off the raw it replaces.
		raw: lineEnding,
		metadata: { columnCount: alignments.length, alignments },
		children: cellRaws.map((cells, i) => ({
			kind: 'tableRow',
			leadingTrivia: '',
			raw: '',
			metadata: { isHeader: i === 0 },
			children: cells.map((raw) => ({ kind: 'tableCell', leadingTrivia: '', raw }))
		}))
	};
	rebuildTableRaw(table);
	return table;
}
