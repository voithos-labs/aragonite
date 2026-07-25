/**
 * Cross-block endpoint coordinate check: an endpoint addressing a table block
 * carries `cellCoordinate: true`, so its offset reads as a row-major cell index
 * and never as a character count. A table path IS cell space; a char offset
 * stored there routes rangeDelete down the generic branch and corrupts the grid,
 * while copy silently drops rows.
 *
 * The normalizer that mints the flag walks `path.length - 1`, so a length-1 table
 * path runs zero iterations and passes through unflagged — which is how the
 * shift-click producer shipped a corrupt endpoint past a seam that looked total.
 * The producer is fixed; this is the belt that catches producer N+1.
 *
 * Same-path pairs are exempt: an intra-table rectangle's focus is unflagged by the
 * endpoint convention while its offset is still a cell index.
 *
 * Resolves on `kind === 'table'`, the same discriminant the endpoint normalizer
 * uses — not the grid contract, which would demand the flag on row paths no
 * producer ever mints.
 */

import type { DocumentView, NodeView } from '../core/node-views';
import type { InvariantViolation } from './assert';

/**
 * The endpoint shape structurally, NOT `selection/`'s `SelectionPoint`: no
 * `invariants/` predicate takes a dependency — runtime or type — on the selection
 * model. The seam passes its own points; they satisfy this by structure.
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
