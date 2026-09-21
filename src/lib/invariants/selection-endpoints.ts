/**
 * G1.29: a cross-block endpoint's offset is read in its own block's coordinates. On a table that
 * means a cell index (a character offset there corrupts the grid through `rangeDelete`'s generic
 * branch); elsewhere a character offset inside `[0, displayLength(raw)]`; and inside a kind with
 * no character positions, one of those two ends, because anything between them cuts an opaque
 * block in half. A pair on the same path is exempt: a rectangle inside one table is not flagged.
 */

import type { DocumentView, NodeView } from '../core/node-views';
import { displayLength } from '../core/lines';
import { isWholeBlockUnit } from '../schema/whole-block-unit';
import type { InvariantViolation } from '../assert';

/**
 * A plain structural point, not `selection/`'s `SelectionPoint`: no check in `invariants/` depends
 * on the selection model, at runtime or in its types.
 */
export interface EndpointCoordinate {
	readonly path: readonly number[];
	readonly offset: number;
	readonly cellCoordinate?: boolean;
}

function resolve(doc: DocumentView, path: readonly number[]): NodeView | null {
	let parent: NodeView | DocumentView = doc;
	for (const idx of path) {
		const child: NodeView | undefined = parent.children?.[idx];
		if (!child) return null;
		parent = child;
	}
	return parent === doc ? null : (parent as NodeView);
}

function samePath(a: readonly number[], b: readonly number[]): boolean {
	return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function checkCrossBlockEndpointCoordinates(
	doc: DocumentView,
	anchor: EndpointCoordinate,
	focus: EndpointCoordinate
): InvariantViolation | null {
	if (samePath(anchor.path, focus.path)) return null;
	for (const [role, point] of [
		['anchor', anchor],
		['focus', focus]
	] as const) {
		const node = resolve(doc, point.path);
		if (!node) continue;
		const violation = point.cellCoordinate
			? checkCellCoordinate(role, point, node)
			: checkCharOffset(role, point, node);
		if (violation) return violation;
	}
	return null;
}

/** The same mistake the other way round: a cell index on a block with no cells is read further
 *  down as a character offset, so the corruption arrives from the opposite side. */
function checkCellCoordinate(
	role: 'anchor' | 'focus',
	point: EndpointCoordinate,
	node: NodeView
): InvariantViolation | null {
	if (node.kind === 'table') return null;
	return {
		code: 'endpoint-cell-coordinate-off-table',
		message: `cross-block ${role} [${point.path.join(',')}] carries a cell index (${point.offset}) against a "${node.kind}", which has no cells`,
		detail: { role, path: [...point.path], offset: point.offset }
	};
}

function checkCharOffset(
	role: 'anchor' | 'focus',
	point: EndpointCoordinate,
	node: NodeView
): InvariantViolation | null {
	const detail = { role, path: [...point.path], offset: point.offset };
	const at = `cross-block ${role} [${point.path.join(',')}]`;
	if (node.kind === 'table') {
		return {
			code: 'endpoint-cell-coordinate',
			message: `${at} addresses a table but carries a character offset (${point.offset})`,
			detail
		};
	}
	const end = displayLength(node.raw);
	if (point.offset < 0 || point.offset > end) {
		return {
			code: 'endpoint-offset-out-of-range',
			message: `${at} carries offset ${point.offset}, outside its "${node.kind}" raw (0..${end})`,
			detail
		};
	}
	if (isWholeBlockUnit(node) && point.offset !== 0 && point.offset !== end) {
		return {
			code: 'endpoint-whole-block-offset',
			message: `${at} carries offset ${point.offset} inside "${node.kind}", which has no character positions: only 0 and ${end} address it`,
			detail
		};
	}
	return null;
}
