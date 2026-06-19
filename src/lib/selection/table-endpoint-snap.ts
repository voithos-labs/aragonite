/**
 * Whole-row snap for cross-block selections with a table endpoint.
 *
 * A table endpoint's offset is a row-major cell index (`cellCoordinate: true`).
 * When a table is one END of a cross-block (different-block) selection, the
 * highlight, clipboard copy, and range delete must agree on the same cell set;
 * left partial, copy row-rounds while delete clears columns and a Cut loses or
 * duplicates cells (findings F1). Snapping each table endpoint to its whole row
 * — start side to the row's first cell, end side to the row's last cell — makes
 * all three paths capture the same whole rows (WYSIWYG: the painted rows are the
 * copied/deleted rows).
 *
 * The offset stays an INCLUSIVE cell index, the same space SelectionPoint
 * already uses, so collapse/reveal still resolve a valid in-range cell. Copy,
 * delete, and overlay convert to their own end-exclusive form at their seams.
 *
 * Only `cellCoordinate` endpoints snap: that flag is what distinguishes a
 * row-major cell index from a char offset on a table-block path. A pointer-drag
 * anchor that lacks the flag (the open F3 anchor gap) is left untouched — once
 * F3 sets the flag there, this snap fires for it automatically.
 *
 * Intra-table selections (both endpoints on the same table) are NOT snapped —
 * rectangular sub-cell selection inside one table is intentionally preserved.
 */

import type { Document } from '../core/nodes';
import { metadataOf } from '../core/nodes';
import { nodeAt } from '../tree-operations/node-ops';
import type { SelectionPoint } from './primitives';
import { comparePaths } from './primitives';

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
	if (!node || !('kind' in node) || node.kind !== 'table') return point;

	const colCount = metadataOf(node, 'table').columnCount;
	const row = Math.floor(point.offset / colCount);
	const snappedOffset = side === 'start' ? row * colCount : row * colCount + colCount - 1;
	if (snappedOffset === point.offset) return point;
	return { ...point, offset: snappedOffset };
}
