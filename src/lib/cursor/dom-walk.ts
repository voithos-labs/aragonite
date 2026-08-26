/**
 * The one iterative pre-order over rendered inline DOM — the caret-space twin of
 * `core/inline/walk.ts`, and here rather than beside it because `cursor/` is what a DOM walk may
 * import from (`ambient/` reads this direction too, `core/` never does). Nesting depth is
 * input-controlled, so a per-level call frame overflows the stack and strands the block in the
 * unhealable failed-block fallback.
 */

/**
 * `root`, then its descendants, in document order. `fromEnd` MIRRORS that walk rather than
 * reversing it — each level's children come last-first, a parent still ahead of them — so the
 * leaves arrive reversed and a search for the last matching one reads them in the order it wants.
 * `descend` declines a node's children: the node itself is still yielded, and is asked only when
 * it has any. Each child list is read when its parent pops, so a consumer that rewrites the tree
 * must finish the walk first.
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
