import type { BlockquoteMetadata, CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import type { GrammarView } from '../schema/block-openers';
import { cloneMetadata, cloneNode } from './clone';
import { rebuildBlockquoteRaw } from '../schema/container-rebuilders';
import { rebuildContainerRaw } from '../schema/container-raw';
import { assignIds } from '../block-id';
import { emptyParagraph } from './node-primitives';
import { firstLineEnding } from '../core/lines';

/**
 * Lift a quote-shaped container's first child out as fresh clones, input untouched. The remainder
 * is always a plain blockquote, since a marker like `[!TYPE]` lives only on the dropped opener.
 */
export function unwrapFirstChildFromQuote(container: NodeView): CstNode[] {
	if (!container.children || container.children.length === 0) {
		return [];
	}

	const clonedChildren: CstNode[] = container.children.map(cloneNode);

	const lifted = clonedChildren[0];
	// The container's leading blank lines are applied at the caller's splice point.
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
 * The replacement when Enter exits a quote's empty trailing paragraph: the trimmed quote, then the
 * exit paragraph to focus, separated so a line typed there doesn't continue the quote on reload.
 */
export function buildQuoteExitReplacement(container: NodeView, grammar: GrammarView): CstNode[] {
	if (!container.children || container.children.length <= 1) return [];

	const trimmed = cloneNode(container);
	trimmed.children = trimmed.children!.slice(0, -1);
	trimmed.childIds = assignIds(trimmed.children);
	rebuildContainerRaw(trimmed, grammar);

	// Every byte this op creates is a line ending. The quote spans two lines at least here, so
	// its bytes hold the document's ending.
	const lineEnding = firstLineEnding(container.raw) ?? '\n';
	return [trimmed, emptyParagraph(lineEnding, lineEnding)];
}
