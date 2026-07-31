/**
 * Pure clipboard payload for an intra-table multi-cell rectangle; the component
 * owns the live ClipboardEvent wiring.
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

export interface IntraTableRect {
	tablePath: number[];
	anchorCellIdx: number;
	focusCellIdx: number;
}

/**
 * Both endpoints share the table path, so each `offset` is a row-major cell index
 * (unflagged — see `selection/primitives` on context-established cell offsets). Callers
 * compare `tablePath` against their own; the rectangle belongs to at most one table.
 */
export function intraTableRect(selection: SelectionState): IntraTableRect | null {
	const { anchor, focus } = selection;
	if (!selection.isCustomRendered || !anchor || !focus || !pathsEqual(anchor.path, focus.path)) {
		return null;
	}
	return { tablePath: anchor.path, anchorCellIdx: anchor.offset, focusCellIdx: focus.offset };
}

/** The GFM sub-table for the current selection, or null when it isn't a rectangle. */
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
