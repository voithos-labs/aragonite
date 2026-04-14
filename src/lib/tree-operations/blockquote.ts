/**
 * Blockquote-specific tree operations. Today: first-child unwrap (Rule U2).
 * More operations get added here if blockquotes gain kind-specific behaviors.
 */

import type { CstNode } from '../core/nodes';
import { cloneNode } from '../mutable-tree';
import { rebuildBlockquoteRaw } from '../container-raw';

/**
 * Compute the result of unwrapping a blockquote's first child.
 * Returns the blocks that should replace the blockquote in its parent's
 * children array.
 * - 1-child blockquote: returns [liftedChild]
 * - N-child blockquote: returns [liftedChild, remainingBlockquote]
 * Input is not mutated; returned blocks are fresh clones via cloneNode
 * (omits the inlineContent rendering cache).
 */
export function unwrapFirstChildFromBlockquote(blockquote: CstNode): CstNode[] {
	if (
		blockquote.kind !== 'blockquote' ||
		!blockquote.children ||
		blockquote.children.length === 0
	) {
		return [];
	}

	// Deep clone children to avoid mutating the input.
	const clonedChildren: CstNode[] = blockquote.children.map(cloneNode);

	const lifted = clonedChildren[0];
	// Lifted child becomes a top-level block in the parent — clear its leading trivia
	// because it inherits the blockquote's position, and the blockquote's leading
	// trivia is applied at the caller's splice point.
	lifted.leadingTrivia = '';

	if (clonedChildren.length === 1) {
		return [lifted];
	}

	// Build the remaining blockquote as a fresh node.
	const remainingChildren = clonedChildren.slice(1);
	// The first remaining child loses its leading-blank-line trivia since it's now
	// the first child of the shrunk blockquote — any gap between it and the lifted
	// block is represented at the parent level (separate blocks in the parent list).
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
