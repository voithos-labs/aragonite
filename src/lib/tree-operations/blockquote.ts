import type { BlockquoteMetadata, CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { cloneMetadata, cloneNode } from './clone';
import { rebuildBlockquoteRaw } from '../schema/container-rebuilders';
import { rebuildContainerRaw } from '../schema/container-raw';
import { assignIds } from '../block-id';
import { emptyParagraph } from './node-ops';
import { trailingLineEnding } from '../core/lines';

/**
 * Unwrap a quote-shaped container's first child (Rule U2), returning fresh clones without
 * mutating the input. It lifts whatever container it is handed; the `lift-first-child-drop-opener`
 * strategy is what restricts the callers. The remainder is always a plain blockquote: a marker like
 * `[!TYPE]` lives only on the opener line, so lifting a body child out drops it and the rest
 * reparses as an ordinary quote.
 */
export function unwrapFirstChildFromQuote(container: NodeView): CstNode[] {
	if (!container.children || container.children.length === 0) {
		return [];
	}

	const clonedChildren: CstNode[] = container.children.map(cloneNode);

	const lifted = clonedChildren[0];
	// The container's leading trivia is applied at the caller's splice point.
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
		metadata:
			container.metadata && 'quoteDepth' in container.metadata
				? (cloneMetadata(container.metadata) as BlockquoteMetadata)
				: { quoteDepth: 1 },
		children: remainingChildren,
		childIds: assignIds(remainingChildren),
		innerPrefix: container.innerPrefix ?? '',
		innerSuffix: container.innerSuffix ?? ''
	};
	rebuildBlockquoteRaw(remaining);

	return [lifted, remaining];
}

/**
 * The parent-level replacement when Enter exits a quote-shaped container's empty trailing
 * paragraph: `[trimmedContainer, exitParagraph]`, the caller's focus target at index 1.
 * Kind-agnostic through the descriptor's `rebuildRaw`; input unmutated. The exit paragraph
 * carries a separator like the list exit's, or a line typed there lazy-continues the
 * container on reload.
 */
export function buildQuoteExitReplacement(container: NodeView): CstNode[] {
	if (!container.children || container.children.length <= 1) return [];

	const trimmed = cloneNode(container);
	trimmed.children = trimmed.children!.slice(0, -1);
	trimmed.childIds = assignIds(trimmed.children);
	rebuildContainerRaw(trimmed);

	// Every byte this op mints is a line ending, so it takes the container's (G4.20).
	const lineEnding = trailingLineEnding(container.raw);
	return [trimmed, emptyParagraph(lineEnding, lineEnding)];
}
