/**
 * The block a range holds whole, for the gestures that insert over it. Such a range has no seam
 * inside it to merge at: the block leaves the tree entirely, so bytes that follow must land in
 * its SLOT rather than at a caret in whatever took the slot.
 */

import type { DocumentView } from '../core/node-views';
import type { SelectionPoint } from './primitives';
import { displayLength } from '../core/lines';
import { isBlockNode, nodeAt } from '../tree-operations/node-primitives';
import { pathsEqual } from './path-math';

/** The block both endpoints address and jointly span, or null. Cell coordinates index a grid
 *  rather than characters: the table's own coverage rule is `cross-block/paste.ts`'s. */
export function blockCoveredWhole(
	doc: DocumentView,
	anchor: SelectionPoint | null,
	focus: SelectionPoint | null
): number[] | null {
	if (!anchor || !focus) return null;
	if (!pathsEqual(anchor.path, focus.path)) return null;
	if (anchor.cellCoordinate || focus.cellCoordinate) return null;
	const node = nodeAt(doc, anchor.path);
	if (!node || !isBlockNode(node)) return null;
	const low = Math.min(anchor.offset, focus.offset);
	const high = Math.max(anchor.offset, focus.offset);
	return low === 0 && high >= displayLength(node.raw) ? anchor.path.slice() : null;
}
