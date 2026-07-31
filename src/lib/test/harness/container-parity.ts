/**
 * Container-parity invariant for keyed BlockList rendering: a container whose
 * `children` outgrows its `childIds` hands Svelte's keyed `{#each}` undefined
 * keys, after which post-undo reconciliation drifts from CST. Call after any
 * structural mutation on a keyed container.
 *
 * Does NOT apply to the document root — top-level ids live on `deps.blockIds`.
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

/** Mirrors `createBlockListState`'s lazy `childIds` seeding, so tests that bypass
 *  the component layer start from the shape Svelte would observe. */
export function seedChildIdsRecursive(node: CstNode): void {
	if (!node.children) return;
	if (!node.childIds) node.childIds = assignIds(node.children);
	for (const child of node.children) seedChildIdsRecursive(child);
}
