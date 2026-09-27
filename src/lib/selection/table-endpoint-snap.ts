/**
 * The cell-index space a selection endpoint inside a grid lives in. Offsets are inclusive cell
 * indices, and every endpoint on a table path carries `cellCoordinate`. The whole-row snap and
 * the metadata reads are for tables only; the coverage functions serve any `containerContract:
 * 'grid'` kind. A pair inside one table is left unsnapped, so a rectangle of cells can be selected.
 */

import type { DocumentView, NodeView } from '../core/node-views';
import { metadataOf } from '../core/nodes';
import { nodeAt } from '../tree-operations/node-primitives';
import { clampCellIndex, countsCells, tableCellCount } from '../schema/block-kind-descriptor';
import type { CellSelectionPoint, SelectionPoint } from './primitives';
import { cellIndexOf, cellPoint } from './primitives';
import { asCellIndex, rowMajorCellIndex, cellRowCol } from '../cursor/coordinate-spaces';
import { comparePaths, pathHasPrefix } from './path-math';
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

/** `point`'s index in `grid`'s cell space, or null on a side the range runs past. A plugin grid's
 *  `[grid, row, col]` path decodes with the same width {@link coveredGridCells} uses. */
export function gridEndpointCellIndex(
	grid: NodeView,
	gridPath: number[],
	point: SelectionPoint
): number | null {
	if (!pathHasPrefix(point.path, gridPath)) return null;
	// On the grid's own path an unflagged offset counts characters, which address no cell.
	if (point.path.length === gridPath.length) return point.cellCoordinate ? point.offset : null;
	const [row, col = 0] = point.path.slice(gridPath.length);
	return rowMajorCellIndex(row, col, gridColumnCount(grid));
}

/** The cells a range covers inside one grid: the rectangle ordered indices `from` and `to` span,
 *  or a run up to the one inside when the other side is null. Rows must share row 0's width. */
export function coveredGridCells(
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
	const rectangle = from !== null && to !== null;

	const cells: GridCell[] = [];
	for (let row = first.row; row <= last.row; row++) {
		const startCol = rectangle ? Math.min(first.col, last.col) : row === first.row ? first.col : 0;
		const endCol = rectangle
			? Math.max(first.col, last.col)
			: row === last.row
				? last.col
				: colCount - 1;
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
