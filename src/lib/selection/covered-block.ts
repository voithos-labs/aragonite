/**
 * The block a range covers whole, for the paste and typing paths that replace it. There is no
 * join inside such a range to merge at: the block leaves the tree, so the new bytes go into
 * its list position rather than at a caret in whatever block took that position.
 */

import type { DocumentView } from '../core/node-views';
import type { SelectionPoint } from './primitives';
import { displayLength } from '../core/lines';
import { isBlockNode, nodeAt } from '../tree-operations/node-primitives';
import { pathsEqual } from './path-math';

/** The block both endpoints sit in and together span end to end, or null. Cell coordinates
 *  index a grid, not characters, so a table is judged by `cross-block/paste.ts` instead. */
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
