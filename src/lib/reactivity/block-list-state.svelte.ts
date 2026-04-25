/**
 * Reactive state bundle for a container's inner BlockList children.
 * innerBlockIds / innerBlockRefs are the Svelte keyed-each source and the
 * component-ref slot array; structural mutations route through the commit
 * primitives on UndoController (commitContainerStructural / commitMultiScope),
 * which apply StructuralChange descriptors to keep ids/refs aligned with
 * children.
 */

import type { CstNode } from '../core/nodes';
import type { BlockComponent } from '../contracts';
import { assignIds } from '../tree-operations/block-id';
import { registerBlockListState } from './state-registry';

export interface BlockListState {
	innerBlockIds: string[];
	innerBlockRefs: (BlockComponent | undefined)[];
}

/**
 * Takes a getter rather than the node directly so undo/redo prop reassignments
 * reach every closure — by-value would capture a stale snapshot.
 */
export function createBlockListState(getNode: () => CstNode): BlockListState {
	let innerBlockIds = $state<string[]>(assignIds(getNode().children ?? []));
	let innerBlockRefs = $state<(BlockComponent | undefined)[]>([]);

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
		}
	};

	registerBlockListState(getNode(), state);
	return state;
}
