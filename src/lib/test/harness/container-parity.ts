/**
 * Checks that a keyed `BlockList` still has one id per child: a container whose `children`
 * outgrows its `childIds` hands Svelte's keyed `{#each}` undefined keys, after which undo
 * reconciles to something other than the tree. Call it after any structural mutation on a keyed
 * container. It does not apply to the document root, whose ids live on `deps.blockIds`.
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

/** Mirrors how `createBlockListState` fills `childIds` on demand, so a test that bypasses the
 *  components starts from the shape Svelte would see. */
export function seedChildIdsRecursive(node: CstNode): void {
	if (!node.children) return;
	if (!node.childIds) node.childIds = assignIds(node.children);
	for (const child of node.children) seedChildIdsRecursive(child);
}
