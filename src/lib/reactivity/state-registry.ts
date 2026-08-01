/** Resolve a container node (by identity; views accepted) to its reactive BlockListState.
 *  WeakMap, so entries collect when the node becomes unreachable. */

import { DEV } from 'esm-env';
import { tick } from 'svelte';
import type { NodeView } from '../core/node-views';
import type { BlockListState } from './block-list-state.svelte';

const stateRegistry = new WeakMap<NodeView, BlockListState>();

/** Overwrites any existing entry — the new state becomes authoritative on re-mount. */
export function registerBlockListState(node: NodeView, state: BlockListState): void {
	const existing = stateRegistry.get(node);
	stateRegistry.set(node, state);
	if (DEV && existing && existing !== state) {
		void reportContestedClaim(node, existing, state);
	}
}

/**
 * A dev signal, not a guarantee. Svelte creates a structural remount's new mount before
 * tearing the old one down, so a claim contested INSIDE a flush says nothing about
 * ownership; re-ask once it settles, when a loser still holding child refs is a genuine
 * second live owner.
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

/** Strict variant, for a caller holding a live-tree node whose container must be mounted.
 *  `getStateForNode` stays for the ancestor walks where absence is a valid signal. */
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
