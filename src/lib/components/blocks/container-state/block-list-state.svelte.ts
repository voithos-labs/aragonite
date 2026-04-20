/**
 * Reactive state bundle for a container block's inner BlockList children.
 * Used by container components (blockquote, list, listItem) and by any
 * future plugin container that holds a linear sequence of child blocks.
 *
 * Why the commit-then-publish pattern in `commitChildrenEdit`: splicing
 * directly on $state proxies (or on node.children, whose parent is a
 * proxy) during a keyed {#each} re-render interleaves reactivity with
 * the mutation and can leave innerBlockRefs out of sync with the
 * rendered components — bind:ref in a keyed each only fires on mount,
 * so shifted or re-mounted children can't rebind an already-populated
 * slot. Committing all three arrays at once gives Svelte a consistent
 * snapshot to diff against and keeps the refs array aligned with the
 * shifted components.
 */

import type { CstNode } from '../../../core/nodes';
import type { BlockComponent } from '../../../contracts';
import { assignIds } from '../../../tree-operations/block-id';
import { registerBlockListState } from './state-registry';

export interface BlockListState {
	/** Reactive IDs for keyed {#each} rendering. */
	innerBlockIds: string[];
	/** Reactive refs to child block components for focus management. */
	innerBlockRefs: (BlockComponent | undefined)[];
	/**
	 * Apply a structural mutation on plain-array copies, then publish all
	 * three arrays atomically. Callers mutate the copies in the callback;
	 * the factory writes the updates back.
	 */
	commitChildrenEdit(
		mutate: (children: CstNode[], ids: string[], refs: (BlockComponent | undefined)[]) => void
	): void;
}

/**
 * Build a reactive state bundle for `node.children`. Takes a getter rather
 * than the node directly so undo/redo prop reassignments reach every closure
 * — passing by value would capture a stale snapshot.
 */
export function createBlockListState(getNode: () => CstNode): BlockListState {
	let innerBlockIds = $state<string[]>(assignIds(getNode().children ?? []));
	let innerBlockRefs = $state<(BlockComponent | undefined)[]>([]);

	function commitChildrenEdit(
		mutate: (children: CstNode[], ids: string[], refs: (BlockComponent | undefined)[]) => void
	): void {
		const node = getNode();
		const childrenCopy = [...(node.children ?? [])];
		const idsCopy = [...innerBlockIds];
		const refsCopy = [...innerBlockRefs];
		mutate(childrenCopy, idsCopy, refsCopy);
		node.children = childrenCopy;
		innerBlockIds = idsCopy;
		innerBlockRefs = refsCopy;
	}

	const state: BlockListState = {
		get innerBlockIds() {
			return innerBlockIds;
		},
		set innerBlockIds(value) {
			innerBlockIds = value;
		},
		get innerBlockRefs() {
			return innerBlockRefs;
		},
		set innerBlockRefs(value) {
			innerBlockRefs = value;
		},
		commitChildrenEdit
	};

	registerBlockListState(getNode(), state);
	return state;
}
