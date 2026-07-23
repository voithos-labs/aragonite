import type { BlockquoteMetadata, CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { cloneMetadata, cloneNode } from './clone';
import { rebuildBlockquoteRaw } from '../schema/container-rebuilders';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { assignIds } from '../block-id';

/**
 * Compute the result of unwrapping a quote-shaped container's first child (Rule
 * U2). Returns [liftedChild] or [liftedChild, remainingBlockquote]. Input is not
 * mutated; returned blocks are fresh clones.
 *
 * Eligibility is the container descriptor's `unwrapRole.quoteShaped` capability,
 * not a kind name: a chrome container sharing `lift-first-child` but omitting the
 * flag no-ops here (its reserved chrome is preserved), so a future quote-shaped
 * kind opts in by declaration alone.
 *
 * The remainder is always a plain blockquote: a GitHub alert's `[!TYPE]` marker
 * lives only on its opener line, so lifting a body child out drops the marker and
 * the rest reparses as an ordinary quote (the model's "unwrap legitimately
 * reparses to a plain blockquote"). A source that already carries blockquote depth
 * metadata keeps it; a marker-only container defaults to depth 1.
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
