/**
 * Container-parity invariant for keyed BlockList rendering.
 *
 * Every container rendered through BlockList (blockquote, list, listItem, table,
 * tableRow) must keep `node.children.length === node.childIds.length`. Svelte's
 * keyed `{#each childIds as id}` block uses `childIds` as the key source; if a
 * structural mutation extends `children` without extending `childIds`, the keys
 * for the trailing entries become `undefined` and Svelte logs
 * `each_key_duplicate`, after which post-undo reconciliation drifts from CST.
 *
 * The invariant does NOT apply to the document root — top-level block ids live
 * on the editor harness (`deps.blockIds`), not on the doc node. Call this on a
 * top-level container or below.
 *
 * Use after any structural mutation on a keyed container (M1 merge, list
 * indent/unindent, paste, table row/column ops) to gate the invariant in tests.
 */

import { expect } from 'vitest';
import { assignIds } from '$lib/block-id';
import type { CstNode } from '$lib/core/nodes';

export function assertContainerParity(node: CstNode, path = 'root'): void {
	if (!node.children) return;
	expect(node.childIds, `${path} (${node.kind}) missing childIds`).toBeDefined();
	expect(
		node.childIds!.length,
		`${path} (${node.kind}) childIds length ${node.childIds!.length} != children length ${node.children.length}`
	).toBe(node.children.length);
	for (let i = 0; i < node.children.length; i++) {
		assertContainerParity(node.children[i], `${path}.${node.kind}[${i}]`);
	}
}

/**
 * Backfill `childIds` on every container in the subtree that lacks them.
 * Mirrors `createBlockListState`'s lazy seeding so unit tests that bypass the
 * component layer start from the same shape Svelte would observe.
 */
export function seedChildIdsRecursive(node: CstNode): void {
	if (!node.children) return;
	if (!node.childIds) node.childIds = assignIds(node.children);
	for (const child of node.children) seedChildIdsRecursive(child);
}
