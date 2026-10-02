import type { CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import type { GrammarView } from '../schema/block-openers';
import { cloneNode } from './clone';
import { rebuildContainerRaw } from '../schema/container-raw';
import { assignIds } from '../block-id';
import { emptyParagraph } from './node-primitives';
import { firstLineEnding } from '../core/lines';
import type { RemainderBuilder } from './container-lift';

/** A quote-shaped container's remainder is always a plain blockquote, since a marker like
 *  `[!TYPE]` lives only on the opener line the lift drops. It starts from the container's bytes,
 *  so the lines it keeps keep their spelling. */
export function plainQuote(grammar: GrammarView): RemainderBuilder {
	return (container, children) => {
		const remaining: CstNode = {
			kind: 'blockquote',
			leadingTrivia: '',
			raw: container.raw,
			metadata: { quoteDepth: 1 },
			children,
			childIds: assignIds(children),
			innerPrefix: container.innerPrefix ?? '',
			innerSuffix: container.innerSuffix ?? ''
		};
		rebuildContainerRaw(remaining, grammar);
		return remaining;
	};
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
