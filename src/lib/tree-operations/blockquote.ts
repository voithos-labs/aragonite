import type { BlockquoteMetadata, CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { cloneMetadata, cloneNode } from './clone';
import { rebuildBlockquoteRaw } from '../schema/container-rebuilders';
import { rebuildContainerRaw } from '../schema/container-raw';
import { assignIds } from '../block-id';
import { emptyParagraph } from './node-primitives';
import { firstLineEnding } from '../core/lines';
import type { RemainderBuilder } from './container-lift';

/** A quote-shaped container's remainder is always a plain blockquote, since a marker like
 *  `[!TYPE]` lives only on the opener line the lift drops. */
export const plainQuote: RemainderBuilder = (container, children) => {
	const remaining: CstNode = {
		kind: 'blockquote',
		leadingTrivia: '',
		raw: '',
		metadata:
			container.metadata && 'quoteDepth' in container.metadata
				? (cloneMetadata(container.metadata) as BlockquoteMetadata)
				: { quoteDepth: 1 },
		children,
		childIds: assignIds(children),
		innerPrefix: container.innerPrefix ?? '',
		innerSuffix: container.innerSuffix ?? ''
	};
	rebuildBlockquoteRaw(remaining);
	return remaining;
};

/**
 * The replacement when Enter exits a quote's empty trailing paragraph: the trimmed quote, then the
 * exit paragraph to focus, separated so a line typed there doesn't continue the quote on reload.
 */
export function buildQuoteExitReplacement(container: NodeView): CstNode[] {
	if (!container.children || container.children.length <= 1) return [];

	const trimmed = cloneNode(container);
	trimmed.children = trimmed.children!.slice(0, -1);
	trimmed.childIds = assignIds(trimmed.children);
	rebuildContainerRaw(trimmed);

	// Every byte this op creates is a line ending. The quote spans two lines at least here, so
	// its bytes hold the document's ending.
	const lineEnding = firstLineEnding(container.raw) ?? '\n';
	return [trimmed, emptyParagraph(lineEnding, lineEnding)];
}
