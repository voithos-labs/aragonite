/**
 * Resolve a container CstNode to its reactive BlockListState. WeakMap so
 * entries collect automatically when the node becomes unreachable.
 */

import type { CstNode } from '../core/nodes';
import type { BlockListState } from './block-list-state.svelte';

const stateRegistry = new WeakMap<CstNode, BlockListState>();

/** Overwrites any existing entry — the new state becomes authoritative on re-mount. */
export function registerBlockListState(node: CstNode, state: BlockListState): void {
	if (import.meta.env.DEV && stateRegistry.has(node)) {
		console.warn(
			`[state-registry] double register for ${node.kind} — overwriting. ` +
				`Likely two components believe they own the same node, or cloneDocument ` +
				`is preserving node identity across snapshots unexpectedly.`
		);
	}
	stateRegistry.set(node, state);
}

export function getStateForNode(node: CstNode): BlockListState | undefined {
	return stateRegistry.get(node);
}

/**
 * Strict variant — throws when `node` has no registered state. Use when the
 * caller holds a node from the live tree whose container must be mounted
 * (structural traversal through a known container). `getStateForNode` stays
 * for the "walk ancestors, skip non-containers" pattern where absence is a
 * valid signal.
 */
export function expectStateForNode(node: CstNode): BlockListState {
	const state = stateRegistry.get(node);
	if (!state) {
		throw new Error(
			`[state-registry] no BlockListState registered for ${node.kind} — ` +
				`caller assumed a mounted container. If this path can visit non-container ` +
				`nodes, use getStateForNode and guard on undefined.`
		);
	}
	return state;
}
