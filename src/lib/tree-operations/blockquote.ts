import type { BlockquoteMetadata, CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { cloneMetadata, cloneNode } from './clone';
import { rebuildBlockquoteRaw } from '../schema/container-rebuilders';
import { assignIds } from '../block-id';

// The two quote-shaped `>`-containers this primitive unwraps. The plugin kind is
// matched by name — core stays free of any plugin import, and the string is the
// only coupling (the alert descriptor lives in the admonitions plugin).
const QUOTE_KINDS = new Set<string>(['blockquote', 'githubAlert']);

/**
 * Compute the result of unwrapping a quote-shaped container's first child (Rule
 * U2). Returns [liftedChild] or [liftedChild, remainingBlockquote]. Input is not
 * mutated; returned blocks are fresh clones.
 *
 * The remainder is always a plain blockquote: a GitHub alert's `[!TYPE]` marker
 * lives only on its opener line, so lifting a body child out drops the marker and
 * the rest reparses as an ordinary quote (the model's "unwrap legitimately
 * reparses to a plain blockquote"). A blockquote source keeps its own depth.
 */
export function unwrapFirstChildFromQuote(container: NodeView): CstNode[] {
	if (!QUOTE_KINDS.has(container.kind) || !container.children || container.children.length === 0) {
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
			container.kind === 'blockquote' && container.metadata
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
