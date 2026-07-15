import type { CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { cloneMetadata, cloneNode } from './clone';
import { rebuildBlockquoteRaw } from '../schema/container-rebuilders';
import { freshChildIds } from '../block-id';

/**
 * Compute the result of unwrapping a blockquote's first child (Rule U2).
 * Returns [liftedChild] or [liftedChild, remainingBlockquote]. Input is not
 * mutated; returned blocks are fresh clones.
 */
export function unwrapFirstChildFromBlockquote(blockquote: NodeView): CstNode[] {
	if (
		blockquote.kind !== 'blockquote' ||
		!blockquote.children ||
		blockquote.children.length === 0
	) {
		return [];
	}

	const clonedChildren: CstNode[] = blockquote.children.map(cloneNode);

	const lifted = clonedChildren[0];
	// Blockquote's leading trivia is applied at the caller's splice point.
	lifted.leadingTrivia = '';

	if (clonedChildren.length === 1) {
		return [lifted];
	}

	const remainingChildren = clonedChildren.slice(1);
	remainingChildren[0].leadingTrivia = '';

	const remaining: CstNode = {
		kind: 'blockquote',
		leadingTrivia: '',
		raw: '',
		metadata: blockquote.metadata ? cloneMetadata(blockquote.metadata) : undefined,
		children: remainingChildren,
		childIds: freshChildIds(remainingChildren),
		innerPrefix: blockquote.innerPrefix ?? '',
		innerSuffix: blockquote.innerSuffix ?? ''
	};
	rebuildBlockquoteRaw(remaining);

	return [lifted, remaining];
}
