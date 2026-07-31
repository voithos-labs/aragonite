/**
 * Reactive state bundle for a container's inner BlockList children: the keyed-each source
 * and the component-ref slot array. Structural mutations route through the commit
 * primitives on UndoController, which apply `StructuralChange` descriptors to keep
 * ids/refs aligned with children.
 */

import { untrack } from 'svelte';
import type { BlockComponent } from '../block-component';
import type { NodeView } from '../core/node-views';
import { assignIds } from '../block-id';
import { registerBlockListState } from './state-registry';

export interface BlockListState {
	innerBlockIds: string[];
	innerBlockRefs: (BlockComponent | undefined)[];
}

/** `getNode` must be a live getter — by-value freezes on the initial node and misses
 *  undo's deep-clone reassignment. A view suffices: the only writes target `childIds`,
 *  the bytes-view carve-out. */
export function createBlockListState(getNode: () => NodeView): BlockListState {
	const initialNode = getNode();
	if (!initialNode.childIds) {
		initialNode.childIds = assignIds(initialNode.children ?? []);
	}

	let innerBlockRefs = $state<(BlockComponent | undefined)[]>([]);

	const state: BlockListState = {
		get innerBlockIds() {
			return getNode().childIds ?? [];
		},
		set innerBlockIds(value) {
			getNode().childIds = value;
		},
		get innerBlockRefs() {
			return innerBlockRefs;
		},
		set innerBlockRefs(value) {
			innerBlockRefs = value;
		}
	};

	// Sync so callers outside a reactive context (unit tests) see the entry on creation.
	registerBlockListState(initialNode, state);

	// Re-register on node-identity changes (undo replaces nodes via deep clone).
	$effect(() => {
		const node = getNode();
		if (!node.childIds) {
			node.childIds = assignIds(node.children ?? []);
		}
		registerBlockListState(node, state);

		// A parent-scope replace can reuse this instance with a node prop that has fewer
		// children than before. Index-keyed ref-setting never clears the stale trailing
		// slots the longer prior node left, so reconcile the length here.
		const childCount = node.children?.length ?? 0;
		untrack(() => {
			if (innerBlockRefs.length > childCount) {
				innerBlockRefs = innerBlockRefs.slice(0, childCount);
			}
		});
	});

	return state;
}
