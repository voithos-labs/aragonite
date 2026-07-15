import type { TableAlignment } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { metadataOf } from '../core/nodes';

export interface CellPos {
	rowIdx: number;
	colIdx: number;
}

export function copyRectangleAsSubTable(table: NodeView, a: CellPos, b: CellPos): string {
	const minRow = Math.min(a.rowIdx, b.rowIdx);
	const maxRow = Math.max(a.rowIdx, b.rowIdx);
	const minCol = Math.min(a.colIdx, b.colIdx);
	const maxCol = Math.max(a.colIdx, b.colIdx);

	const rows = table.children ?? [];
	const cellRaws: string[][] = [];
	for (let r = minRow; r <= maxRow; r++) {
		const rowCells = rows[r]?.children ?? [];
		const slice: string[] = [];
		for (let c = minCol; c <= maxCol; c++) {
			slice.push(rowCells[c]?.raw ?? '');
		}
		cellRaws.push(slice);
	}

	if (cellRaws.length === 1 && cellRaws[0].length === 1) {
		return cellRaws[0][0];
	}

	const alignments = metadataOf(table, 'table').alignments.slice(minCol, maxCol + 1);

	const lines: string[] = [];
	lines.push(formatRow(cellRaws[0]));
	lines.push(formatRow(alignments.map(formatAlignmentCell)));
	for (let i = 1; i < cellRaws.length; i++) {
		lines.push(formatRow(cellRaws[i]));
	}
	return lines.join('');
}

function formatRow(cells: string[]): string {
	return '| ' + cells.join(' | ') + ' |\n';
}

function formatAlignmentCell(alignment: TableAlignment): string {
	switch (alignment) {
		case 'left':
			return ':---';
		case 'center':
			return ':---:';
		case 'right':
			return '---:';
		default:
			return '---';
	}
}
