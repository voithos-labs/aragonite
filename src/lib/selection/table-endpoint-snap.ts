/**
 * Whole-row snap for cross-block selections with a table endpoint. Highlight, clipboard copy,
 * and range delete must agree on the same cell set; left partial, copy row-rounds while delete
 * clears columns and a Cut loses cells. Offsets stay INCLUSIVE cell indices, the space
 * SelectionPoint already uses. Only `cellCoordinate` endpoints snap; intra-table selections are
 * deliberately left alone, so rectangular sub-cell selection survives.
 */

import type { DocumentView, NodeView } from '../core/node-views';
import { metadataOf } from '../core/nodes';
import { isBlockNode, nodeAt } from '../tree-operations/node-ops';
import type { CellSelectionPoint, SelectionPoint } from './primitives';
import { cellIndexOf } from './primitives';
import { asCellIndex, cellRowCol } from '../cursor/coordinate-spaces';
import { comparePaths } from './path-math';
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

/**
 * Inverse of {@link normalizeTableEndpoint}: expand an endpoint addressing a table block to its
 * deep `[tableIdx, row, col]` leaf path so reveal/caret placement reaches an off-window cell.
 * Null when the path is already a leaf or the index lands outside the grid. Resolution is on the
 * NODE KIND, not the `cellCoordinate` flag: an intra-table focus is unflagged (see
 * {@link SelectionPoint}) yet still a cell index, which is why the index is minted rather than
 * read through `cellIndexOf`.
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
