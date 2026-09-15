/**
 * The one iterative pre-order traversal of rendered inline DOM, the DOM counterpart of
 * `core/inline/walk.ts`. It lives here rather than beside it because `cursor/` is what a DOM walk
 * may import from (`ambient/` reads this direction too, `core/` never does). Nesting depth comes
 * from the input, so recursion would overflow the stack and leave the block stuck in the
 * failed-block fallback.
 */

/**
 * `root`, then its descendants, in document order. `fromEnd` mirrors that walk rather than
 * reversing it (each level's children come last-first, a parent still ahead of them), so a search
 * for the last matching leaf reads the leaves in the order it wants. `descend` declines a node's
 * children; the node itself is still yielded. Each child list is read when its parent pops, so a
 * caller that rewrites the tree must finish the walk first.
 */
export function* domDescendants(
	root: Node,
	descend?: (node: Node) => boolean,
	options: { fromEnd?: boolean } = {}
): Generator<Node> {
	const stack: Node[] = [root];
	while (stack.length > 0) {
		const node = stack.pop()!;
		yield node;
		const children = node.childNodes;
		if (children.length === 0) continue;
		if (descend && !descend(node)) continue;
		// Reversed push, so pop order is the walk's order: document order, or its reverse.
		for (let i = 0; i < children.length; i++) {
			stack.push(children[options.fromEnd ? i : children.length - 1 - i]);
		}
	}
}
