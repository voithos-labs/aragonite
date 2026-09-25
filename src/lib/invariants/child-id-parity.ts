/**
 * A keyed container's `childIds` hold one id per child, at every depth: a container whose
 * `children` outgrow its ids hands the keyed each block undefined keys, and the redraw after undo
 * reconciles to something other than the tree. A container that never mounted has no `childIds`
 * yet and passes, unless the caller seeded every container first and asks for `everyKeyed`.
 */

import type { NodeView } from '../core/node-views';
import type { InvariantViolation } from '../assert';

export function checkChildIdParity(
	node: NodeView,
	options: { everyKeyed?: boolean } = {}
): InvariantViolation | null {
	return walk(node, options.everyKeyed ?? false, node.kind);
}

function walk(node: NodeView, everyKeyed: boolean, at: string): InvariantViolation | null {
	if (!node.children) return null;
	const ids = node.childIds;
	if (ids === undefined ? everyKeyed : ids.length !== node.children.length) {
		return {
			code: 'child-id-parity',
			message: `${at}: ${ids?.length ?? 'no'} child ids for ${node.children.length} children`,
			detail: { kind: node.kind, children: node.children.length, ids: ids?.length }
		};
	}
	for (let i = 0; i < node.children.length; i++) {
		const violation = walk(node.children[i], everyKeyed, `${at}[${i}] ${node.children[i].kind}`);
		if (violation) return violation;
	}
	return null;
}
