/**
 * A keyed container's `childIds` hold one id per child, at every depth: a container whose
 * `children` outgrow its ids hands the keyed each block undefined keys, and the redraw after undo
 * reconciles to something other than the tree. A container that never mounted has no `childIds`
 * yet and passes, unless the caller seeded every container first and asks for `everyKeyed`.
 */

import type { NodeView } from '../core/node-views';
import type { InvariantViolation } from '../assert';

export interface ChildIdDrift {
	/** Child indices from the checked node down to the container out of step. */
	path: number[];
	kind: string;
	children: number;
	ids: number | undefined;
	/** The kinds from the checked node down, for a message a reader can follow. */
	trail: string;
}

export interface ChildIdParityOptions {
	everyKeyed?: boolean;
}

export function checkChildIdParity(
	node: NodeView,
	options: ChildIdParityOptions = {}
): InvariantViolation | null {
	const [first] = childIdDrifts(node, options, 1);
	if (!first) return null;
	return {
		code: 'child-id-parity',
		message: `${first.trail}: ${first.ids ?? 'no'} child ids for ${first.children} children`,
		detail: { kind: first.kind, children: first.children, ids: first.ids }
	};
}

/** Every container under `node` (itself included) whose ids are out of step, in document order. */
export function childIdDrifts(
	node: NodeView,
	options: ChildIdParityOptions = {},
	limit = Infinity
): ChildIdDrift[] {
	const drifts: ChildIdDrift[] = [];
	const everyKeyed = options.everyKeyed ?? false;
	const stack: { node: NodeView; path: number[]; trail: string }[] = [
		{ node, path: [], trail: node.kind }
	];
	while (stack.length > 0 && drifts.length < limit) {
		const { node: at, path, trail } = stack.pop()!;
		if (!at.children) continue;
		const ids = at.childIds;
		if (ids === undefined ? everyKeyed : ids.length !== at.children.length) {
			drifts.push({ path, kind: at.kind, children: at.children.length, ids: ids?.length, trail });
		}
		// Reversed push, so the pops come out in document order.
		for (let i = at.children.length - 1; i >= 0; i--) {
			const child = at.children[i];
			stack.push({ node: child, path: [...path, i], trail: `${trail}[${i}] ${child.kind}` });
		}
	}
	return drifts;
}
