/**
 * Resolves a container CstNode to its reactive BlockListState.
 *
 * WeakMap is the correct primitive: when a node becomes unreachable
 * (undo replaces the doc with a cloneDocument output, component unmount
 * with no other refs), the registry entry collects automatically. No
 * manual unregister — the lifecycle is the garbage collector's.
 *
 * Callers that route cross-state children mutations through this
 * registry (list-context.ts's indentItem/promoteNestedItem, the nested
 * structural-paste branch of cross-block-dispatch.ts) rely on the
 * invariant that every mounted container's BlockListState is registered
 * here. Registration happens inside createBlockListState, which runs in
 * every container component's script block at mount.
 */

import type { CstNode } from '../../../core/nodes';
import type { BlockListState } from './block-list-state.svelte';

const stateRegistry = new WeakMap<CstNode, BlockListState>();

/**
 * Record that `state` manages `node.children`. Called from
 * createBlockListState after state assembly.
 *
 * Overwrites any existing entry — a re-mount at the same node (rare,
 * but possible if a future cloneDocument optimization preserves subtree
 * identity) is the canonical reason to re-register. The new state
 * becomes authoritative; any reference the now-unmounted component
 * still holds to the old state simply stops being reachable via the
 * registry.
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
