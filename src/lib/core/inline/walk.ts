/**
 * The one iterative pre-order over an inline tree. Nesting depth is input-controlled (a `**` run
 * nests one construct per pair), so a per-level call frame overflows the stack and strands the
 * block in the unhealable failed-block fallback. Dependency-free, so the scan reaches it without
 * closing a cycle through the inline entry point.
 */

import type { InlineNode } from '../nodes';

/**
 * Each node, then its children, in source order. `descend` declines a node's children — the node
 * itself is still yielded, and is asked only when it has any. Yields nodes only: what a reader
 * SEES stays the render path's question (G4.33). Each child list is snapshotted onto the stack
 * when its parent pops, so a consumer that rewrites `children` must finish the walk first.
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
