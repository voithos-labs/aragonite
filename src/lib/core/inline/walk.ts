/**
 * The one iterative pre-order over an inline tree: nesting depth is input-controlled, so a
 * recursive walk could overflow the stack.
 */

import type { InlineNode } from '../nodes';

/** `descend` returning false skips a node's children but still yields the node. Finish the walk
 *  before rewriting any `children`: a child list is read only after its parent is yielded. */
export function* inlineDescendants(
	nodes: readonly InlineNode[],
	descend?: (node: InlineNode) => boolean
): Generator<InlineNode> {
	// Reversed push, so pop order is source order.
	const stack: InlineNode[] = [];
	for (let i = nodes.length - 1; i >= 0; i--) stack.push(nodes[i]);
	while (stack.length > 0) {
		const node = stack.pop()!;
		yield node;
		const children = node.children;
		if (!children || children.length === 0) continue;
		if (descend && !descend(node)) continue;
		for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
	}
}
