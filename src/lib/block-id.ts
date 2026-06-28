import type { CstNode } from './core/nodes';

export function generateBlockId(): string {
	return crypto.randomUUID();
}

export function assignIds(children: CstNode[]): string[] {
	return children.map(() => generateBlockId());
}

/** Fresh ids for a freshly-built children array (builders constructing new containers). */
export function freshChildIds(children: CstNode[]): string[] {
	return assignIds(children);
}

/**
 * Initialize `childIds` on every container in a freshly-parsed subtree before it
 * is spliced into the live tree: a reused container component reads `childIds` in
 * its keyed-each synchronously, so a missing array surfaces as `undefined` keys.
 */
export function assignChildIdsDeep(node: CstNode): void {
	if (node.children && node.children.length > 0 && !node.childIds) {
		node.childIds = assignIds(node.children);
	}
	for (const child of node.children ?? []) assignChildIdsDeep(child);
}
