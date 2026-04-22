/**
 * Resolve a container CstNode to its reactive BlockListState. WeakMap so
 * entries collect automatically when the node becomes unreachable.
 */

import type { CstNode } from '../../../core/nodes';
import type { BlockListState } from './block-list-state.svelte';

const stateRegistry = new WeakMap<CstNode, BlockListState>();

/** Overwrites any existing entry — the new state becomes authoritative on re-mount. */
export function registerBlockListState(node: CstNode, state: BlockListState): void {
	if (import.meta.env.DEV && stateRegistry.has(node)) {
		console.warn(
			`[container-state] double register for ${node.kind} — overwriting. ` +
				`Likely two components believe they own the same node, or cloneDocument ` +
				`is preserving node identity across snapshots unexpectedly.`
		);
	}
	stateRegistry.set(node, state);
}

export function getStateForNode(node: CstNode): BlockListState | undefined {
	return stateRegistry.get(node);
}
