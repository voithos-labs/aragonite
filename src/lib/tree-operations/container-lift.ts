/**
 * Lift a container's first child out, input untouched: the blank line that stood between that
 * child and the next one now stands between the lifted block and what is left of the container.
 * The caller says how the rest is written back: as the same container, or as a plain quote.
 */

import type { CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { cloneNode } from './clone';
import { rebuildContainerRaw } from '../schema/container-raw';
import { assignIds } from '../block-id';

/** The container's remaining children written back as one block; its own raw included. */
export type RemainderBuilder = (container: NodeView, children: CstNode[]) => CstNode;

export function liftFirstChild(container: NodeView, rebuildRemainder: RemainderBuilder): CstNode[] {
	const children = container.children;
	if (!children || children.length === 0) return [];

	const lifted = cloneNode(children[0]);
	// The container's leading blank lines are applied at the caller's splice point.
	lifted.leadingTrivia = '';
	if (children.length === 1) return [lifted];

	const remainingChildren = children.slice(1).map(cloneNode);
	const separator = remainingChildren[0].leadingTrivia;
	remainingChildren[0].leadingTrivia = '';
	const remaining = rebuildRemainder(container, remainingChildren);
	remaining.leadingTrivia = separator;
	return [lifted, remaining];
}

/** The remainder keeps the container's kind, and its `rebuildRaw` re-emits the syntax, so a
 *  marker held in metadata survives. */
export const sameContainer: RemainderBuilder = (container, children) => {
	const remaining = cloneNode(container);
	remaining.children = children;
	remaining.childIds = assignIds(children);
	rebuildContainerRaw(remaining);
	return remaining;
};
