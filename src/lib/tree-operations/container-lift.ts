/**
 * Lift a container's first child out while the container itself survives (Rule U2's other
 * shape): the remainder keeps its kind and its `rebuildRaw` re-emits the syntax, so a marker
 * held in metadata rides through. `blockquote.ts`'s `unwrapFirstChildFromQuote` is the shape
 * where the opener lives on the first line and the lift drops it.
 */

import type { CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { cloneNode } from './clone';
import { rebuildContainerRaw } from '../schema/container-raw';
import { assignIds } from '../block-id';

export function liftFirstChildKeepingContainer(container: NodeView): CstNode[] {
	const children = container.children;
	if (!children || children.length === 0) return [];

	const lifted = cloneNode(children[0]);
	// The container's leading trivia is applied at the caller's splice point.
	lifted.leadingTrivia = '';
	if (children.length === 1) return [lifted];

	const remaining = cloneNode(container);
	const remainingChildren = remaining.children!.slice(1);
	// The blank line that stood between the two children inside the container is the one that
	// now stands between the lifted block and the container: conserved, never minted.
	remaining.leadingTrivia = remainingChildren[0].leadingTrivia;
	remainingChildren[0].leadingTrivia = '';
	remaining.children = remainingChildren;
	remaining.childIds = assignIds(remainingChildren);
	rebuildContainerRaw(remaining);

	return [lifted, remaining];
}
