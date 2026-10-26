/**
 * Keyboard extension geometry for a selection focus on a table cell. Vertical keys step a whole row
 * rather than walking the next document-order leaf, and exit at the table's first or last row. A
 * rectangle inside one table also steps sideways, clamped at the column edges, since a rectangle
 * has no sideways exit.
 */

import type { DocumentView } from '../core/node-views';
import { metadataOf } from '../core/nodes';
import { nodeAt } from '../tree-operations/node-primitives';
import { countsCells } from '../schema/block-kind-descriptor';
import { rowMajorCellIndex, cellRowCol } from '../core/coordinate-spaces';
import { cellIndexOf, type SelectionPoint } from './primitives';
import { pathsEqual } from './path-math';

export type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

export type TableRectExtension =
	| { kind: 'cell'; offset: number }
	| { kind: 'exit'; direction: 'forward' | 'backward'; fromCellPath: number[] };

/** What a Shift+Arrow does to a focus on a cell; null off a cell, and for a sideways key unless the
 *  anchor is a cell of the same table (`anchor === focus` is a one-cell rectangle). */
export function tableFocusExtension(
	doc: DocumentView,
	anchor: SelectionPoint | null,
	focus: SelectionPoint | null,
	key: ArrowKey
): TableRectExtension | null {
	if (!focus?.cellCoordinate) return null;
	const rectangle = !!anchor?.cellCoordinate && pathsEqual(anchor.path, focus.path);
	if (!rectangle && (key === 'ArrowLeft' || key === 'ArrowRight')) return null;
	const node = nodeAt(doc, focus.path);
	if (!node || !countsCells(node)) return null;

	const colCount = metadataOf(node, 'table').columnCount;
	const rowCount = node.children?.length ?? 0;
	if (colCount === 0 || rowCount === 0) return null;

	const path = focus.path;
	const { row, col } = cellRowCol(cellIndexOf(focus, 'tableFocusExtension'), colCount);
	const at = (r: number, c: number): TableRectExtension => ({
		kind: 'cell',
		offset: rowMajorCellIndex(r, c, colCount)
	});

	switch (key) {
		case 'ArrowDown':
			return row < rowCount - 1
				? at(row + 1, col)
				: {
						kind: 'exit',
						direction: 'forward',
						fromCellPath: [...path, rowCount - 1, colCount - 1]
					};
		case 'ArrowUp':
			return row > 0
				? at(row - 1, col)
				: { kind: 'exit', direction: 'backward', fromCellPath: [...path, 0, 0] };
		case 'ArrowRight':
			return at(row, Math.min(col + 1, colCount - 1));
		case 'ArrowLeft':
			return at(row, Math.max(col - 1, 0));
	}
}
