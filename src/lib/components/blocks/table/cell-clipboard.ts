/**
 * Pure clipboard payload for an intra-table multi-cell rectangle; the component
 * owns the live ClipboardEvent wiring.
 */

import type { DocumentGetter } from '../../../editor-keys';
import type { SelectionState } from '../../../selection/selection-state.svelte';
import { metadataOf } from '../../../core/nodes';
import { isBlockNode, nodeAt } from '../../../tree-operations/node-primitives';
import { pathsEqual } from '../../../selection/path-math';
import { cellIndexOf } from '../../../selection/primitives';
import { countsCells } from '../../../schema/block-kind-descriptor';
import { cellRectBounds } from '../../../cursor/coordinate-spaces';
import { copyRectangleAsSubTable } from '../../../tree-operations/sub-table-copy';
import { rectangleGrid } from '../../../tree-operations/table-grid-clipboard';

export interface CellClipboardDeps {
	selection: SelectionState;
	getDoc: DocumentGetter;
}

export interface IntraTableRect {
	tablePath: number[];
	anchorCellIdx: number;
	focusCellIdx: number;
}

/** The cell rectangle inside one table, or null. Callers compare `tablePath` with their own:
 *  the rectangle belongs to one table at most. */
export function intraTableRect(selection: SelectionState): IntraTableRect | null {
	const { anchor, focus } = selection;
	if (!selection.isCustomRendered || !anchor?.cellCoordinate || !focus?.cellCoordinate) {
		return null;
	}
	if (!pathsEqual(anchor.path, focus.path)) return null;
	return {
		tablePath: anchor.path,
		anchorCellIdx: cellIndexOf(anchor, 'intraTableRect:anchor'),
		focusCellIdx: cellIndexOf(focus, 'intraTableRect:focus')
	};
}

/** The GFM sub-table for the current selection, or null when it isn't a rectangle. */
export function intraTableRectPayload(deps: CellClipboardDeps): string | null {
	const bounds = intraTableRectBounds(deps);
	if (!bounds) return null;
	const tableNode = nodeAt(deps.getDoc(), bounds.tablePath);
	if (!tableNode || !isBlockNode(tableNode)) return null;
	const { top, left, rows, cols } = bounds;
	return copyRectangleAsSubTable(
		tableNode,
		{ rowIdx: top, colIdx: left },
		{ rowIdx: top + rows - 1, colIdx: left + cols - 1 }
	);
}

/** The rectangle's row and column bounds, or null when the selection isn't a cell rectangle. */
export function intraTableRectBounds(
	deps: CellClipboardDeps
): { tablePath: number[]; top: number; left: number; rows: number; cols: number } | null {
	const rect = intraTableRect(deps.selection);
	if (!rect) return null;
	const tableNode = nodeAt(deps.getDoc(), rect.tablePath);
	if (!tableNode || !countsCells(tableNode)) return null;
	const colCount = metadataOf(tableNode, 'table').columnCount;
	return {
		tablePath: rect.tablePath,
		...cellRectBounds(rect.anchorCellIdx, rect.focusCellIdx, colCount)
	};
}

/** The rectangle's cell texts as a grid (pipes unescaped), for the spreadsheet formats. */
export function intraTableRectGrid(deps: CellClipboardDeps): string[][] | null {
	const bounds = intraTableRectBounds(deps);
	if (!bounds) return null;
	const tableNode = nodeAt(deps.getDoc(), bounds.tablePath);
	if (!tableNode || !isBlockNode(tableNode)) return null;
	const { top, left, rows, cols } = bounds;
	return rectangleGrid(
		tableNode,
		{ rowIdx: top, colIdx: left },
		{ rowIdx: top + rows - 1, colIdx: left + cols - 1 }
	);
}
