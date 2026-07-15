import type { NodeView } from './core/node-views';

export function generateBlockId(): string {
	return crypto.randomUUID();
}

// View-typed: one id per slot, content never read — and `childIds` is the
// bytes-view carve-out, legal to write even on a snapshot-shared node.
export function assignIds(children: readonly NodeView[]): string[] {
	return children.map(() => generateBlockId());
}

export function freshChildIds(children: readonly NodeView[]): string[] {
	return assignIds(children);
}

/**
 * Initialize `childIds` on every container in a freshly-parsed subtree before it
 * is spliced into the live tree: a reused container component reads `childIds` in
 * its keyed-each synchronously, so a missing array surfaces as `undefined` keys.
 */
export function assignChildIdsDeep(node: NodeView): void {
	if (node.children && node.children.length > 0 && !node.childIds) {
		node.childIds = assignIds(node.children);
	}
	for (const child of node.children ?? []) assignChildIdsDeep(child);
}
