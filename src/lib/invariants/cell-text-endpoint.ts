/**
 * G1.178: a stored text endpoint inside a table cell pairs only with one in that same cell (a
 * finger's word there). Paired with an end anywhere else, it's read as text where the delete, the
 * copy and the paint expect a cell index, so a write that kept it skipped the cell snap.
 */

import type { DocumentView, NodeView } from '../core/node-views';
import { countsCells } from '../schema/block-kind-descriptor';
import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';
import type { EndpointCoordinate } from './selection-endpoints';

export function checkCellTextEndpoint(
	doc: DocumentView,
	anchor: EndpointCoordinate,
	focus: EndpointCoordinate
): InvariantViolation | null {
	for (const [point, other] of [
		[anchor, focus],
		[focus, anchor]
	] as const) {
		if (point.cellCoordinate || !insideTable(doc, point.path)) continue;
		if (point.path.join() === other.path.join()) continue;
		return {
			code: 'cell-text-endpoint-unpaired',
			message: `a text endpoint in cell [${point.path.join(',')}] pairs with [${other.path.join(',')}] outside that cell`,
			detail: { cell: [...point.path], other: [...other.path] }
		};
	}
	return null;
}

function insideTable(doc: DocumentView, path: readonly number[]): boolean {
	let parent: NodeView | DocumentView = doc;
	for (let depth = 0; depth < path.length - 1; depth++) {
		const child: NodeView | undefined = parent.children?.[path[depth]];
		if (!child) return false;
		if (countsCells(child)) return true;
		parent = child;
	}
	return false;
}
