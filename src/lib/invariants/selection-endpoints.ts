/**
 * G1.29 — a cross-block endpoint addressing a table carries `cellCoordinate: true`, so its
 * offset reads as a row-major cell index; a char offset there routes rangeDelete down the
 * generic branch and corrupts the grid. Same-path pairs are exempt (an intra-table
 * rectangle's focus is unflagged by convention). Resolves on `kind === 'table'`, the
 * endpoint normalizer's discriminant, not the grid contract.
 */

import type { DocumentView, NodeView } from '../core/node-views';
import type { InvariantViolation } from './assert';

/**
 * Structural, NOT `selection/`'s `SelectionPoint`: no `invariants/` predicate takes a
 * dependency — runtime or type — on the selection model.
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
		if (point.cellCoordinate) continue;
		if (resolve(doc, point.path)?.kind !== 'table') continue;
		return {
			code: 'endpoint-cell-coordinate',
			message: `cross-block ${role} [${point.path.join(',')}] addresses a table but carries a character offset (${point.offset})`,
			detail: { role, path: [...point.path], offset: point.offset }
		};
	}
	return null;
}
