/**
 * Resolves a container CstNode to its reactive BlockListState.
 *
 * WeakMap: when a node becomes unreachable (undo replaces the doc, component
 * unmounts with no other refs), the registry entry collects automatically.
 * Every mounted container's BlockListState is registered here; registration
 * happens inside createBlockListState at mount time.
 */

import type { CstNode } from '../../../core/nodes';
import type { BlockListState } from './block-list-state.svelte';

const stateRegistry = new WeakMap<CstNode, BlockListState>();

/**
 * Record that `state` manages `node.children`. Overwrites any existing
 * entry — the new state becomes authoritative on re-mount.
 */
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

/**
 * Resolve `node` to its reactive BlockListState, or undefined if the
 * node has no registered state (not a container, or not currently
 * mounted).
 */
export function getStateForNode(node: CstNode): BlockListState | undefined {
	return stateRegistry.get(node);
}
