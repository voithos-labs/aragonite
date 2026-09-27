/**
 * Keyboard extension geometry for an intra-table rectangle. Shift+Arrow grows the rectangle
 * cell-by-cell rather than walking the next document-order leaf, which would descend into the
 * table and snap the focus back to cellIdx 0. Vertical extension exits at the row boundary;
 * horizontal extension clamps at the column edges, since a rectangle has no sideways exit.
 */

import type { DocumentView } from '../core/node-views';
import { metadataOf } from '../core/nodes';
import { nodeAt } from '../tree-operations/node-primitives';
import { countsCells } from './table-endpoint-snap';
import { cellIndexAt, cellRowCol } from '../cursor/coordinate-spaces';
import { cellIndexOf, type SelectionPoint } from './primitives';
import { pathsEqual } from './path-math';

export type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

export type TableRectExtension =
	| { kind: 'cell'; offset: number }
	| { kind: 'exit'; direction: 'forward' | 'backward'; fromCellPath: number[] };

/**
 * The extension a Shift+Arrow produces for an intra-table rectangle, or null when the selection
 * is not a same-table pair of cell endpoints. `anchor === focus` is a valid one-cell rectangle,
 * so the first Shift+Arrow starts here too.
 */
export function intraTableRectExtension(
	doc: DocumentView,
	anchor: SelectionPoint | null,
	focus: SelectionPoint | null,
	key: ArrowKey
): TableRectExtension | null {
	if (!anchor?.cellCoordinate || !focus?.cellCoordinate) return null;
	if (!pathsEqual(anchor.path, focus.path)) return null;
	const node = nodeAt(doc, focus.path);
	if (!node || !countsCells(node)) return null;

	const colCount = metadataOf(node, 'table').columnCount;
	const rowCount = node.children?.length ?? 0;
	if (colCount === 0 || rowCount === 0) return null;

	const path = focus.path;
	const { row, col } = cellRowCol(cellIndexOf(focus, 'intraTableRectExtension'), colCount);
	const at = (r: number, c: number): TableRectExtension => ({
		kind: 'cell',
		offset: cellIndexAt(r, c, colCount)
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
