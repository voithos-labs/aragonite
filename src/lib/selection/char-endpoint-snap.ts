/**
 * Clamps a cross-block endpoint's character offset into its own block's raw, the counterpart of
 * `table-endpoint-snap.ts` for cells. Inside a kind with no character positions the endpoint
 * snaps to whichever end faces the other endpoint in document order, never by anchor/focus
 * role, since `normalize` reorders those later.
 */

import type { DocumentView } from '../core/node-views';
import { displayLength, snapToScalarBoundary } from '../core/lines';
import { isBlockNode, nodeAt } from '../tree-operations/node-primitives';
import { isWholeBlockUnit } from '../schema/whole-block-unit';
import { comparePaths } from './path-math';
import { isWholeBlockEndpoint, type SelectionEndpoint, type SelectionPoint } from './primitives';

/**
 * `endpoint` clamped into its block's character range. Equal paths have no document order and
 * no cross-block range, so they resolve to the block start. Tables pass through untouched; the
 * cell snap owns them.
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
	// Clamps the range, then snaps to a scalar boundary: `setSelection` takes plain numbers, so
	// this is the only check between a caller's arithmetic and a delete that splits a surrogate pair.
	const clamped = snapToScalarBoundary(node.raw, Math.min(Math.max(endpoint.offset, 0), end));
	return clamped === endpoint.offset ? endpoint : { path: endpoint.path.slice(), offset: clamped };
}
