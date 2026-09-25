/**
 * The one iterative pre-order over an inline tree: nesting depth is input-controlled, so a
 * recursive walk could overflow the stack.
 */

import type { InlineNode } from '../nodes';

/**
 * Each node, then its children, in source order; `descend` returning false skips a node's
 * children but still yields the node. A consumer that rewrites `children` must finish the walk
 * first: each child list is copied onto the stack when its parent pops.
 */
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
