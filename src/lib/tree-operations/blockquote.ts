import type { BlockquoteMetadata, CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { cloneMetadata, cloneNode } from './clone';
import { rebuildBlockquoteRaw } from '../schema/container-rebuilders';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { assignIds } from '../block-id';

/**
 * Unwrap a quote-shaped container's first child (Rule U2), returning fresh clones without
 * mutating the input. Eligibility is `unwrapRole.quoteShaped`, not a kind name, so a
 * future quote-shaped kind opts in by declaration alone. The remainder is always a plain
 * blockquote: a marker like `[!TYPE]` lives only on the opener line, so lifting a body
 * child out drops it and the rest reparses as an ordinary quote.
 */
export function unwrapFirstChildFromQuote(container: NodeView): CstNode[] {
	const quoteShaped = tryGetBlockKindDescriptor(container.kind)?.unwrapRole?.quoteShaped;
	if (!quoteShaped || !container.children || container.children.length === 0) {
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
