/**
 * What copying a rectangle of table cells writes: a GFM sub-table for plain text and an HTML
 * table for spreadsheets. The cell's copy and the editor root's copy both write it.
 */

import type { DocumentView } from '../core/node-views';
import { isBlockNode, nodeAt } from '../tree-operations/node-primitives';
import { copyRectangleAsSubTable } from '../tree-operations/sub-table-copy';
import { gridToHtmlTable, rectangleGrid } from '../tree-operations/table-grid-clipboard';
import type { GridCoverage } from './range-coverage';

export interface GridClipboard {
	text: string;
	html: string;
}

/** Null for a single cell, whose copy is its own text. */
export function gridClipboard(doc: DocumentView, grid: GridCoverage): GridClipboard | null {
	const { top, left, rows, cols } = grid.rect;
	if (rows * cols === 1) return null;
	const table = nodeAt(doc, grid.path);
	if (!table || !isBlockNode(table)) return null;
	const from = { rowIdx: top, colIdx: left };
	const to = { rowIdx: top + rows - 1, colIdx: left + cols - 1 };
	return {
		text: copyRectangleAsSubTable(table, from, to),
		html: gridToHtmlTable(rectangleGrid(table, from, to))
	};
}
