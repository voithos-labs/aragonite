/**
 * Reactive state bundle for a container's inner BlockList children.
 *
 * `commitChildrenEdit` publishes children + ids + refs atomically: splicing
 * directly on $state proxies during a keyed {#each} re-render interleaves
 * reactivity with mutation and leaves `innerBlockRefs` out of sync (bind:ref
 * in a keyed each fires only on mount, so shifted children can't rebind an
 * already-populated slot). One atomic commit gives Svelte a consistent
 * snapshot to diff against.
 */

import type { CstNode } from '../../../core/nodes';
import type { BlockComponent } from '../../../contracts';
import { assignIds } from '../../../tree-operations/block-id';
import { registerBlockListState } from './state-registry';

export interface BlockListState {
	innerBlockIds: string[];
	innerBlockRefs: (BlockComponent | undefined)[];
	/**
	 * Mutate plain-array copies, then publish children + ids + refs atomically.
	 */
	commitChildrenEdit(
		mutate: (children: CstNode[], ids: string[], refs: (BlockComponent | undefined)[]) => void
	): void;
}

/**
 * Takes a getter rather than the node directly so undo/redo prop reassignments
 * reach every closure — by-value would capture a stale snapshot.
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
