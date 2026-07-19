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
import { copyRectangleAsSubTable } from '../../../tree-operations/sub-table-copy';

export interface CellClipboardDeps {
	selection: SelectionState;
	getDoc: DocumentGetter;
}

/**
 * Build the GFM sub-table for the current selection, or null when the selection
 * isn't a multi-cell rectangle within a single table.
 */
export function intraTableRectPayload(deps: CellClipboardDeps): string | null {
	const sel = deps.selection;
	const isIntraTableMultiCell =
		sel.isCustomRendered && sel.anchor && sel.focus && pathsEqual(sel.anchor.path, sel.focus.path);
	if (!isIntraTableMultiCell || !sel.anchor || !sel.focus) return null;

	const tableNode = nodeAt(deps.getDoc(), sel.anchor.path);
	if (!tableNode || !isBlockNode(tableNode) || tableNode.kind !== 'table') return null;

	// Same-path intra-table rectangle: cell offsets are context-established
	// (same table, unflagged), so read directly.
	const colCount = metadataOf(tableNode, 'table').columnCount;
	const a = {
		rowIdx: Math.floor(sel.anchor.offset / colCount),
		colIdx: sel.anchor.offset % colCount
	};
	const b = {
		rowIdx: Math.floor(sel.focus.offset / colCount),
		colIdx: sel.focus.offset % colCount
	};
	return copyRectangleAsSubTable(tableNode, a, b);
}
