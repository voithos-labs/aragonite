/**
 * Resolve a container node (by identity; views accepted) to its reactive BlockListState. WeakMap so
 * entries collect automatically when the node becomes unreachable.
 */

import { tick } from 'svelte';
import type { NodeView } from '../core/node-views';
import type { BlockListState } from './block-list-state.svelte';

const stateRegistry = new WeakMap<NodeView, BlockListState>();

/** Overwrites any existing entry — the new state becomes authoritative on re-mount. */
export function registerBlockListState(node: NodeView, state: BlockListState): void {
	const existing = stateRegistry.get(node);
	stateRegistry.set(node, state);
	if (import.meta.env.DEV && existing && existing !== state) {
		void reportContestedClaim(node, existing, state);
	}
}

/**
 * A structural remount moves a node from one mount to another — a list indent
 * splices the item's node into a new parent — and Svelte creates the new mount
 * before tearing the old one down, so a claim contested INSIDE a flush says
 * nothing about ownership. Re-ask once the flush settles: a loser that gave up
 * its child refs was torn down (the handoff), while one still holding them is a
 * second live owner writing into a state nothing can resolve, which is what this
 * warns about. Two holes in the net, both deliberate: a childless loser is
 * indistinguishable and reads as a handoff (it has no refs to orphan, so there is
 * nothing to protect), and a third registration in the same tick drops the earlier
 * contest unreported — naming a winner that no longer owns the node would be worse
 * than silence. This is a dev signal, not a guarantee.
 */
async function reportContestedClaim(
	node: NodeView,
	loser: BlockListState,
	winner: BlockListState
): Promise<void> {
	await tick();
	if (stateRegistry.get(node) !== winner) return;
	if (loser.innerBlockRefs.every((ref) => ref === undefined)) return;
	console.warn(
		`[state-registry] two live components claim the same ${node.kind} — the loser's ` +
			`child refs are orphaned. Either both mounts render this node, or cloneDocument ` +
			`is preserving node identity across snapshots unexpectedly.`
	);
}

export function getStateForNode(node: NodeView): BlockListState | undefined {
	return stateRegistry.get(node);
}

/**
 * Strict variant — throws when `node` has no registered state. Use when the
 * caller holds a node from the live tree whose container must be mounted
 * (structural traversal through a known container). `getStateForNode` stays
 * for the "walk ancestors, skip non-containers" pattern where absence is a
 * valid signal.
 */
export function expectStateForNode(node: NodeView): BlockListState {
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
