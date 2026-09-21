/**
 * A container's inner block list: where its keyed-each ids come from and where its child
 * component refs are stored. Structural changes go through the commit calls on
 * `UndoController`, which apply a `StructuralChange` to keep ids and refs lined up with the
 * children.
 */

import type { BlockComponent } from '../block-component';
import type { NodeView } from '../core/node-views';
import { assignIds } from '../block-id';
import { registerBlockListState } from './state-registry';
import { refSlotsOver, type RefSlots } from './publish-ref.svelte';

export interface BlockListState {
	/** Settable because the ids live on the node, where the write reaches the `$state` proxy.
	 *  The refs do not: the array's identity is what this list is known by, so `replaceRefs`
	 *  writes its contents and the property itself never moves. */
	innerBlockIds: string[];
	readonly innerBlockRefs: (BlockComponent | undefined)[];
	/** The accessors for this list's child entries, created once here so every caller (the
	 *  child list, the container component, the mount registry) goes through one object. */
	readonly refSlots: RefSlots<BlockComponent>;
}

/** `getNode` must be a live getter: passing the node by value freezes on the first one and
 *  misses the deep clone undo puts in its place. A view is enough, since the only writes go to
 *  `childIds`, the one field a readonly view still allows. */
export function createBlockListState(getNode: () => NodeView): BlockListState {
	const initialNode = getNode();
	if (!initialNode.childIds) {
		initialNode.childIds = assignIds(initialNode.children ?? []);
	}

	const innerBlockRefs: (BlockComponent | undefined)[] = [];

	const state: BlockListState = {
		get innerBlockIds() {
			return getNode().childIds ?? [];
		},
		set innerBlockIds(value) {
			getNode().childIds = value;
		},
		innerBlockRefs,
		refSlots: refSlotsOver(innerBlockRefs)
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

		// A replacement in the parent list can reuse this instance with a node prop that has
		// fewer children than before. Cleanup empties the entries that leave but never shrinks the
		// array, and the refs length must match the children exactly, so fix it here.
		const childCount = node.children?.length ?? 0;
		if (innerBlockRefs.length > childCount) {
			innerBlockRefs.length = childCount;
		}
	});

	return state;
}
