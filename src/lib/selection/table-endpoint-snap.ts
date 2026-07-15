/**
 * Whole-row snap for cross-block selections with a table endpoint.
 *
 * A table endpoint's offset is a row-major cell index (`cellCoordinate: true`).
 * When a table is one END of a cross-block (different-block) selection, the
 * highlight, clipboard copy, and range delete must agree on the same cell set.
 * Left partial, copy row-rounds while delete clears columns — a Cut then loses
 * or duplicates cells. Snapping each table endpoint to its whole row (start side
 * to the row's first cell, end side to the row's last cell) makes all three paths
 * capture the same whole rows: the painted rows are the copied/deleted rows.
 *
 * The offset stays an INCLUSIVE cell index, the same space SelectionPoint
 * already uses, so collapse/reveal still resolve a valid in-range cell. Copy,
 * delete, and overlay convert to their own end-exclusive form at their seams.
 *
 * Only `cellCoordinate` endpoints snap: that flag is what distinguishes a
 * row-major cell index from a char offset on a table-block path; unflagged
 * endpoints pass through untouched.
 *
 * Intra-table selections (both endpoints on the same table) are NOT snapped —
 * rectangular sub-cell selection inside one table is intentionally preserved.
 */

import type { Document } from '../core/nodes';
import { metadataOf } from '../core/nodes';
import { isBlockNode, nodeAt } from '../tree-operations/node-ops';
import type { SelectionPoint } from './primitives';
import { cellIndexOf } from './primitives';
import { asCellIndex } from '../cursor/coordinate-spaces';
import { comparePaths } from './path-math';

/**
 * A cross-block selection endpoint inside a table must address the table block
 * by row-major cell index (`[tableIdx]` + cellIdx), matching the pointer-drag
 * representation. A deep `[tableIdx, row, col]` leaf path with a character
 * offset routes the delete through the generic (non-table-aware) path, which
 * merges external text into a cell and corrupts the grid. Non-table paths pass
 * through unchanged. SelectionState applies this to every incoming point, so
 * entry paths need not call it themselves.
 */
export function normalizeTableEndpoint(
	doc: Document,
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
			};
		}
	}
	return { path: path.slice(), offset };
}

/**
 * Inverse of {@link normalizeTableEndpoint}: expand a cell-coordinate endpoint
 * back to its deep `[tableIdx, row, col]` leaf path so reveal/caret placement can
 * reach the off-window cell. Null for non-cell-coordinate points (the path is
 * already the leaf).
 */
export function cellEndpointDeepPath(doc: Document, point: SelectionPoint): number[] | null {
	if (!point.cellCoordinate) return null;
	const node = nodeAt(doc, point.path);
	if (!node || !isBlockNode(node) || node.kind !== 'table') return null;
	const colCount = metadataOf(node, 'table').columnCount;
	const cellIdx = cellIndexOf(point, 'cellEndpointDeepPath');
	return [...point.path, Math.floor(cellIdx / colCount), cellIdx % colCount];
}

export function snapCrossBlockTableEndpoints(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint
): { start: SelectionPoint; end: SelectionPoint } {
	if (comparePaths(start.path, end.path) === 0) return { start, end };
	return {
		start: snapEndpoint(doc, start, 'start'),
		end: snapEndpoint(doc, end, 'end')
	};
}

function snapEndpoint(doc: Document, point: SelectionPoint, side: 'start' | 'end'): SelectionPoint {
	if (!point.cellCoordinate) return point;
	const node = nodeAt(doc, point.path);
	if (!node || !isBlockNode(node) || node.kind !== 'table') return point;

	const colCount = metadataOf(node, 'table').columnCount;
	const cellIdx = cellIndexOf(point, 'snapCrossBlockTableEndpoints');
	const row = Math.floor(cellIdx / colCount);
	const snappedOffset = side === 'start' ? row * colCount : row * colCount + colCount - 1;
	if (snappedOffset === cellIdx) return point;
	return { ...point, offset: snappedOffset };
}
