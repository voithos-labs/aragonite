/**
 * The keyed-container id check (`invariants/child-id-parity.ts`) for suites that mutate the tree
 * without components: seed every container the way a mounted list does, mutate, then assert.
 * It does not apply to the document root, whose ids live on `deps.blockIds`.
 */

import { expect } from 'vitest';
import type { CstNode } from '$lib/core/nodes';
import { checkChildIdParity } from '$lib/invariants/child-id-parity';
import { makeBlockListState } from './editor-actions';

export function assertContainerParity(node: CstNode): void {
	expect(checkChildIdParity(node, { everyKeyed: true })).toBeNull();
}

/** Builds each container's production list state, which fills its `childIds` as a mount does. */
export function seedChildIdsRecursive(node: CstNode): void {
	if (!node.children) return;
	makeBlockListState(() => node);
	for (const child of node.children) seedChildIdsRecursive(child);
}
