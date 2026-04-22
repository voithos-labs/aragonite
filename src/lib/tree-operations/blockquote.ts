import type { CstNode } from '../core/nodes';
import { cloneNode } from './clone';
import { rebuildBlockquoteRaw } from './container-raw';

/**
 * Compute the result of unwrapping a blockquote's first child (Rule U2).
 * Returns [liftedChild] or [liftedChild, remainingBlockquote]. Input is not
 * mutated; returned blocks are fresh clones (omits the inlineContent cache).
 */
export function unwrapFirstChildFromBlockquote(blockquote: CstNode): CstNode[] {
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
		metadata: blockquote.metadata ? { ...blockquote.metadata } : undefined,
		children: remainingChildren,
		innerPrefix: blockquote.innerPrefix ?? '',
		innerSuffix: blockquote.innerSuffix ?? ''
	};
	rebuildBlockquoteRaw(remaining);

	return [lifted, remaining];
}
