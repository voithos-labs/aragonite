/**
 * The cell-index space a selection endpoint inside a grid lives in. Offsets are INCLUSIVE cell
 * indices, the space SelectionPoint already uses. The whole-row snap and the two metadata reads
 * answer for a table alone; the coverage tenants answer for any `containerContract: 'grid'` kind.
 * An intra-table pair is deliberately left unsnapped, so rectangular sub-cell selection survives.
 */

import type { DocumentView, NodeView } from '../core/node-views';
import { metadataOf } from '../core/nodes';
import { isBlockNode, nodeAt } from '../tree-operations/node-ops';
import type { CellSelectionPoint, SelectionPoint } from './primitives';
import { cellIndexOf } from './primitives';
import { asCellIndex, cellRowCol } from '../cursor/coordinate-spaces';
import { comparePaths, pathHasPrefix } from './path-math';
import { devWarn } from '../dev-warn';

/**
 * The char→cell conversion funnel: a cross-block endpoint inside a table must address the table
 * block by row-major cell index, or a deep `[tableIdx, row, col]` path with a char offset routes
 * the delete down the generic branch and corrupts the grid. SelectionState applies this to every
 * incoming point, so entry paths never call it themselves. Non-table paths pass through.
 */
export function normalizeTableEndpoint(
	doc: DocumentView,
	path: number[],
	offset: number
): SelectionPoint {
	for (let d = 0; d < path.length - 1; d++) {
		const node = nodeAt(doc, path.slice(0, d + 1));
		if (node && isBlockNode(node) && node.kind === 'table') {
			const colCount = metadataOf(node, 'table').columnCount;
			const rowIdx = path[d + 1];
			const colIdx = path[d + 2] ?? 0;
			return {
				path: path.slice(0, d + 1),
				offset: asCellIndex(rowIdx * colCount + colIdx),
				cellCoordinate: true
			} satisfies CellSelectionPoint;
		}
	}
	return { path: path.slice(), offset };
}

/**
 * How many cells a table's index space holds, the exclusive upper bound on any row-major cell
 * index. `node` must be a table block; the metadata read is unchecked, so other kinds give NaN.
 * Lives beside the bounds check below so a caller's clamp and the check cannot drift apart.
 */
export function tableCellCount(node: NodeView): number {
	return (node.children?.length ?? 0) * metadataOf(node, 'table').columnCount;
}

/** One cell of a grid, with the doc-absolute path that addresses it. */
export interface GridCell {
	node: NodeView;
	path: number[];
}

/** A grid's own width, row 0's cell count — not `metadata.columnCount`: `containerContract: 'grid'`
 *  is a plugin contract, and a kind with no table metadata reaches here. A column mutation splices
 *  each row and the count together, so the two agree on a table. */
function gridColumnCount(grid: NodeView): number {
	return grid.children?.[0]?.children?.length ?? 0;
}

/**
 * `point`'s index in `grid`'s cell space, null where it addresses no cell of it — the side the
 * range runs past, which reads as the grid's own edge. A table's endpoint arrives on the grid path
 * already carrying the index; a plugin grid's keeps the deep `[grid, row, col]` path G1.29 permits,
 * and resolves through the same width {@link coveredGridCells} decodes with.
 */
export function gridEndpointCellIndex(
	grid: NodeView,
	gridPath: number[],
	point: SelectionPoint
): number | null {
	if (!pathHasPrefix(point.path, gridPath)) return null;
	// On the grid's own path, resolution is the NODE KIND's, not the flag's ({@link
	// cellEndpointDeepPath}): a table path IS cell space, so an intra-table rectangle's unflagged
	// corner counts cells, while any other grid holds a char offset addressing no cell.
	if (point.path.length === gridPath.length)
		return point.cellCoordinate || grid.kind === 'table' ? point.offset : null;
	const [row, col = 0] = point.path.slice(gridPath.length);
	return row * gridColumnCount(grid) + col;
}

/**
 * The cells a range covers inside one grid, in document order. `from`/`to` are the range's own cell
 * indices IN DOCUMENT ORDER (`from <= to`; unordered inputs answer with fewer cells or none), null
 * on a side the range runs past. Both inside is the RECTANGLE they span — what the overlay paints
 * and `range-delete-table` clears; one inside is a run to that cell inclusive. Rows of cells is the
 * whole shape asked: children that are not rows of cells answer with no cells, rows of unequal
 * width with the wrong cells or none, every index being row 0's width.
 */
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

/**
 * Inverse of {@link normalizeTableEndpoint}: expand an endpoint addressing a table block to its
 * deep `[tableIdx, row, col]` leaf path so reveal/caret placement reaches an off-window cell.
 * Null when the path is already a leaf or the index lands outside the grid. Resolution is on the
 * NODE KIND, not the `cellCoordinate` flag: an intra-table focus is unflagged (see
 * {@link SelectionPoint}) yet still a cell index. Callers reach it through
 * `SelectionState.cellLandingFor`, which is where the landing rule lives.
 */
export function cellEndpointDeepPath(doc: DocumentView, point: SelectionPoint): number[] | null {
	const node = nodeAt(doc, point.path);
	if (!node || !isBlockNode(node) || node.kind !== 'table') return null;
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
	if (!node || !isBlockNode(node) || node.kind !== 'table') return point;

	const colCount = metadataOf(node, 'table').columnCount;
	const cellIdx = cellIndexOf(point, 'snapCrossBlockTableEndpoints');
	const { row } = cellRowCol(cellIdx, colCount);
	const snappedOffset = side === 'start' ? row * colCount : row * colCount + colCount - 1;
	if (snappedOffset === cellIdx) return point;
	return { ...point, offset: snappedOffset } satisfies CellSelectionPoint;
}
