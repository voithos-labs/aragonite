/**
 * Rectangular-clipboard payload for an intra-table multi-cell selection. When
 * the SelectionState carries a shallow multi-cell encoding (anchor.path ===
 * focus.path === tablePath, offsets are cellIdx-based), this builds the GFM
 * sub-table text the cell's copy/cut handlers write to the clipboard. The
 * component owns the live ClipboardEvent wiring; this owns the pure payload.
 */

import type { DocumentGetter } from '../../../editor-keys';
import type { SelectionState } from '../../../selection/selection-state.svelte';
import { metadataOf } from '../../../core/nodes';
import { isBlockNode, nodeAt } from '../../../tree-operations/node-ops';
import { pathsEqual } from '../../../selection/path-math';
import { cellRowCol } from '../../../cursor/coordinate-spaces';
import { copyRectangleAsSubTable } from '../../../tree-operations/sub-table-copy';

export interface CellClipboardDeps {
	selection: SelectionState;
	getDoc: DocumentGetter;
}

/**
 * A live intra-table rectangle: both cross-block endpoints share the table path,
 * so each `offset` is a row-major cell index established by that shared scope
 * (unflagged — see `selection/primitives` on context-established cell offsets).
 * Returns the shared table path and the two cell indices, or null when the
 * selection isn't such a rectangle. Callers decode the indices with `cellRowCol`
 * against their own column count. One home for a predicate the copy, highlight,
 * and cell-collection paths otherwise each spelled out inline.
 */
export function intraTableRect(
	selection: SelectionState
): { tablePath: number[]; anchorCellIdx: number; focusCellIdx: number } | null {
	const { anchor, focus } = selection;
	if (!selection.isCustomRendered || !anchor || !focus || !pathsEqual(anchor.path, focus.path)) {
		return null;
	}
	return { tablePath: anchor.path, anchorCellIdx: anchor.offset, focusCellIdx: focus.offset };
}

/**
 * Build the GFM sub-table for the current selection, or null when the selection
 * isn't a multi-cell rectangle within a single table.
 */
export function intraTableRectPayload(deps: CellClipboardDeps): string | null {
	const rect = intraTableRect(deps.selection);
	if (!rect) return null;

	const tableNode = nodeAt(deps.getDoc(), rect.tablePath);
	if (!tableNode || !isBlockNode(tableNode) || tableNode.kind !== 'table') return null;

	const colCount = metadataOf(tableNode, 'table').columnCount;
	const a = cellRowCol(rect.anchorCellIdx, colCount);
	const b = cellRowCol(rect.focusCellIdx, colCount);
	return copyRectangleAsSubTable(
		tableNode,
		{ rowIdx: a.row, colIdx: a.col },
		{ rowIdx: b.row, colIdx: b.col }
	);
}
