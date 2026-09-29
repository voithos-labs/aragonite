/**
 * The cells a live pair inside one table holds, read off `rangeCoverage`, and what copying them
 * writes: the rectangle as a GFM sub-table for plain text and as an HTML table for spreadsheets.
 * The cell's copy, the editor root's copy and the table's cell painting all read it here.
 */

import type { DocumentView } from '../core/node-views';
import type { SelectionState } from './selection-state.svelte';
import { isBlockNode, nodeAt } from '../tree-operations/node-primitives';
import { copyRectangleAsSubTable } from '../tree-operations/sub-table-copy';
import { gridToHtmlTable, rectangleGrid } from '../tree-operations/table-grid-clipboard';
import { pathsEqual } from './path-math';
import { coverRange, rangeCoverage, type GridCoverage } from './range-coverage';

/** The grid coverage of the live selection when it is a rectangle of cells, or null. Reads the
 *  document only when there is one, so a caret costs nothing here. */
export function liveGrid(selection: SelectionState, doc: DocumentView): GridCoverage | null {
	const { anchor, focus } = selection;
	if (!selection.isCustomRendered || !anchor?.cellCoordinate || !focus?.cellCoordinate) {
		return null;
	}
	if (!pathsEqual(anchor.path, focus.path)) return null;
	return rangeCoverage(doc, coverRange(doc, anchor, focus)).grid;
}

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
