/**
 * The char-space funnel, sibling of `table-endpoint-snap.ts`'s cell-space one: a cross-block
 * endpoint's offset lands inside its own block's raw, and inside a kind with no character
 * positions it lands on one of the two ends — a hit-test over such a block's rendered body walks
 * chrome text and mints neither. Whole-unit inclusion is the rule: the side comes from document
 * order against the other endpoint, never the anchor/focus role, which `normalize` reorders later.
 */

import type { DocumentView } from '../core/node-views';
import { displayLength, snapToScalarBoundary } from '../core/lines';
import { isBlockNode, nodeAt } from '../tree-operations/node-ops';
import { isWholeBlockUnit } from '../schema/whole-block-unit';
import { comparePaths } from './path-math';
import { isWholeBlockEndpoint, type SelectionEndpoint, type SelectionPoint } from './primitives';

/**
 * `endpoint` in its block's legal char space. Equal paths carry no document order — and no
 * cross-block range — so they resolve to the block start. Tables are the cell funnel's subject
 * and pass through untouched.
 */
export function normalizeCharEndpoint(
	doc: DocumentView,
	endpoint: SelectionEndpoint,
	otherPath: readonly number[]
): SelectionPoint {
	const node = nodeAt(doc, endpoint.path);
	if (!node || !isBlockNode(node)) {
		return isWholeBlockEndpoint(endpoint) ? { path: endpoint.path.slice(), offset: 0 } : endpoint;
	}
	const end = displayLength(node.raw);
	const wholeUnit: SelectionPoint = {
		path: endpoint.path.slice(),
		offset: comparePaths(endpoint.path, otherPath) > 0 ? end : 0
	};
	if (isWholeBlockEndpoint(endpoint)) return wholeUnit;
	if (node.kind === 'table') return endpoint;
	if (isWholeBlockUnit(node)) {
		return endpoint.offset === 0 || endpoint.offset === end ? endpoint : wholeUnit;
	}
	// Range AND scalar: `setSelection` takes plain numbers, so this is the only gate between a
	// caller's arithmetic and a delete that would halve an astral scalar.
	const clamped = snapToScalarBoundary(node.raw, Math.min(Math.max(endpoint.offset, 0), end));
	return clamped === endpoint.offset ? endpoint : { path: endpoint.path.slice(), offset: clamped };
}
