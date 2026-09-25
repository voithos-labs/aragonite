/** Find a container node's `BlockListState` by identity (a view works too). A `WeakMap`,
 *  so entries are collected once the node is unreachable. */

import { DEV } from 'esm-env';
import { tick } from 'svelte';
import type { NodeView } from '../core/node-views';
import type { BlockListState } from './block-list-state.svelte';
import { devWarn } from '../dev-warn';

const stateRegistry = new WeakMap<NodeView, BlockListState>();

/** Overwrites any existing entry: on a remount the new state is the one that counts. */
export function registerBlockListState(node: NodeView, state: BlockListState): void {
	const existing = stateRegistry.get(node);
	stateRegistry.set(node, state);
	if (DEV && existing && existing !== state) {
		void reportContestedClaim(node, existing, state);
	}
}

/** A dev-mode signal, checked a tick later because Svelte mounts a remount's new component
 *  before tearing down the old one: a loser still holding child refs then has a live rival. */
async function reportContestedClaim(
	node: NodeView,
	loser: BlockListState,
	winner: BlockListState
): Promise<void> {
	await tick();
	if (stateRegistry.get(node) !== winner) return;
	if (loser.innerBlockRefs.every((ref) => ref === undefined)) return;
	devWarn(
		'state-registry',
		`two live components claim the same ${node.kind}: the loser's child refs are orphaned. ` +
			`Either both mounts render this node, or the loser's teardown emptied slots the ` +
			`scope no longer reads.`
	);
}

export function getStateForNode(node: NodeView): BlockListState | undefined {
	return stateRegistry.get(node);
}

/** The strict version, for a caller holding a live-tree node whose container must be
 *  mounted. `getStateForNode` stays for the ancestor traversals where a missing entry is a
 *  valid answer. */
export function expectStateForNode(node: NodeView): BlockListState {
	const state = stateRegistry.get(node);
	if (!state) {
		throw new Error(
			`[state-registry] no BlockListState registered for ${node.kind}: ` +
				`caller assumed a mounted container. If this path can visit non-container ` +
				`nodes, use getStateForNode and guard on undefined.`
		);
	}
	return state;
}
