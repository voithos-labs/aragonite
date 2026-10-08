/**
 * The cell-index space a selection endpoint inside a grid lives in. Offsets are inclusive cell
 * indices, and every endpoint on a table path carries `cellCoordinate`. The whole-row snap and
 * the metadata reads are for tables only; the cell lists serve any `containerContract: 'grid'`
 * kind. A pair inside one table is left unsnapped, so a rectangle of cells can be selected.
 */

import type { DocumentView, NodeView } from '../core/node-views';
import { metadataOf } from '../core/nodes';
import { nodeAt } from '../tree-operations/node-primitives';
import { clampCellIndex, countsCells, tableCellCount } from '../schema/block-kind-descriptor';
import type { CellSelectionPoint, SelectionPoint } from './primitives';
import { cellIndexOf, cellPoint } from './primitives';
import {
	asCellIndex,
	rowMajorCellIndex,
	cellRowCol,
	type CellRect
} from '../caret/coordinate-spaces';
import { comparePaths } from './path-math';
import { devWarn } from '../dev-warn';

/** The one conversion into cell space, which `SelectionState` applies to every incoming point: an
 *  endpoint on or inside a table becomes the table path plus a flagged row-major cell index. */
export function normalizeTableEndpoint(
	doc: DocumentView,
	path: number[],
	offset: number
): SelectionPoint {
	for (let d = 0; d < path.length; d++) {
		const tablePath = path.slice(0, d + 1);
		const node = nodeAt(doc, tablePath);
		if (!node || !countsCells(node)) continue;
		// On the table's own path the offset is already the cell index.
		if (d === path.length - 1) return cellPoint(tablePath, clampCellIndex(node, offset));
		const colCount = metadataOf(node, 'table').columnCount;
		return cellPoint(tablePath, rowMajorCellIndex(path[d + 1], path[d + 2] ?? 0, colCount));
	}
	return { path: path.slice(), offset };
}

/** A table taken whole, as the cell on one side of it; null when `path` names no table. */
export function wholeTableEndpoint(
	doc: DocumentView,
	path: number[],
	side: 'start' | 'end'
): CellSelectionPoint | null {
	const node = nodeAt(doc, path);
	if (!node || !countsCells(node)) return null;
	const offset = side === 'end' ? clampCellIndex(node, Infinity) : 0;
	return cellPoint(path, offset);
}

/** One cell of a grid, with the doc-absolute path that addresses it. */
export interface GridCell {
	node: NodeView;
	path: number[];
}

/** A grid's width as row 0's cell count, not `metadata.columnCount`: a plugin grid kind has no
 *  table metadata. On a table the two agree, since a column edit changes both together. */
function gridColumnCount(grid: NodeView): number {
	return grid.children?.[0]?.children?.length ?? 0;
}

/** The cells of `rect` inside one grid, row by row. */
export function gridCellsInRect(grid: NodeView, gridPath: number[], rect: CellRect): GridCell[] {
	const cells: GridCell[] = [];
	for (let row = rect.top; row < rect.top + rect.rows; row++) {
		for (let col = rect.left; col < rect.left + rect.cols; col++) {
			const node = grid.children?.[row]?.children?.[col];
			if (node) cells.push({ node, path: [...gridPath, row, col] });
		}
	}
	return cells;
}

/** The cells a run covers inside one grid, in row-major order, a null side running to the grid's
 *  edge. Rows must share row 0's width. */
export function gridCellsInRun(
	grid: NodeView,
	gridPath: number[],
	from: number | null,
	to: number | null
): GridCell[] {
	const rows = grid.children ?? [];
	const colCount = gridColumnCount(grid);
	if (rows.length === 0 || colCount < 1) return [];
	const lastIndex = rows.length * colCount - 1;
	const clamp = (index: number) => Math.min(Math.max(index, 0), lastIndex);
	const first = cellRowCol(asCellIndex(clamp(from ?? 0)), colCount);
	const last = cellRowCol(asCellIndex(clamp(to ?? lastIndex)), colCount);

	const cells: GridCell[] = [];
	for (let row = first.row; row <= last.row; row++) {
		const startCol = row === first.row ? first.col : 0;
		const endCol = row === last.row ? last.col : colCount - 1;
		for (let col = startCol; col <= endCol; col++) {
			const node = rows[row]?.children?.[col];
			if (node) cells.push({ node, path: [...gridPath, row, col] });
		}
	}
	return cells;
}

/** The inverse of {@link normalizeTableEndpoint}: a cell endpoint's `[tableIdx, row, col]` leaf
 *  path, or null. Reach it through `SelectionState.cellLandingFor`. */
export function cellEndpointDeepPath(doc: DocumentView, point: SelectionPoint): number[] | null {
	if (!point.cellCoordinate) return null;
	const node = nodeAt(doc, point.path);
	if (!node || !countsCells(node)) return null;
	const colCount = metadataOf(node, 'table').columnCount;
	const cellIdx = asCellIndex(point.offset);
	const cellCount = tableCellCount(node);
	if (cellIdx < 0 || cellIdx >= cellCount) {
		devWarn('table-endpoint-snap', 'cell index outside the grid', { point, colCount, cellCount });
		return null;
	}
	const { row, col } = cellRowCol(cellIdx, colCount);
	return [...point.path, row, col];
}

export function snapCrossBlockTableEndpoints(
	doc: DocumentView,
	start: SelectionPoint,
	end: SelectionPoint
): { start: SelectionPoint; end: SelectionPoint } {
	if (comparePaths(start.path, end.path) === 0) return { start, end };
	return {
		start: snapEndpoint(doc, start, 'start'),
		end: snapEndpoint(doc, end, 'end')
	};
}

function snapEndpoint(
	doc: DocumentView,
	point: SelectionPoint,
	side: 'start' | 'end'
): SelectionPoint {
	if (!point.cellCoordinate) return point;
	const node = nodeAt(doc, point.path);
	if (!node || !countsCells(node)) return point;

	const colCount = metadataOf(node, 'table').columnCount;
	const cellIdx = cellIndexOf(point, 'snapCrossBlockTableEndpoints');
	const { row } = cellRowCol(cellIdx, colCount);
	const snappedOffset = rowMajorCellIndex(row, side === 'start' ? 0 : colCount - 1, colCount);
	if (snappedOffset === cellIdx) return point;
	return cellPoint(point.path, snappedOffset);
}
