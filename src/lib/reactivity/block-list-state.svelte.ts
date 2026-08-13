/**
 * A container's inner BlockList scope: the keyed-each id source and the component-ref slot
 * array. Structural mutations route through the commit primitives on UndoController, which
 * apply `StructuralChange` descriptors to keep ids/refs aligned with children.
 */

import type { BlockComponent } from '../block-component';
import type { NodeView } from '../core/node-views';
import { assignIds } from '../block-id';
import { registerBlockListState } from './state-registry';
import { refSlotsOver, replaceRefs, type RefSlots } from './publish-ref.svelte';

export interface BlockListState {
	innerBlockIds: string[];
	innerBlockRefs: (BlockComponent | undefined)[];
	/** This scope's slot accessors, minted once here so every consumer — the child list,
	 *  the container surface, the mount registry — addresses the scope by one identity. */
	readonly refSlots: RefSlots<BlockComponent>;
}

/** `getNode` must be a live getter — by-value freezes on the initial node and misses
 *  undo's deep-clone reassignment. A view suffices: the only writes target `childIds`,
 *  the bytes-view carve-out. */
export function createBlockListState(getNode: () => NodeView): BlockListState {
	const initialNode = getNode();
	if (!initialNode.childIds) {
		initialNode.childIds = assignIds(initialNode.children ?? []);
	}

	// Plain and never replaced (`refSlotsOver`): a mount's teardown reads pre-flush values, so
	// a commit that swaps this array in the same flush strands the teardown's clear on the copy.
	const innerBlockRefs: (BlockComponent | undefined)[] = [];

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
			replaceRefs(innerBlockRefs, value);
		},
		refSlots: refSlotsOver(() => innerBlockRefs)
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
		// children than before. Publish cleanup empties departing slots but never shrinks
		// the array, and refs length must track children exactly, so reconcile it here.
		const childCount = node.children?.length ?? 0;
		if (innerBlockRefs.length > childCount) {
			innerBlockRefs.length = childCount;
		}
	});

	return state;
}
