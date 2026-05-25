/**
 * Reactive state bundle for a container's inner BlockList children.
 * innerBlockIds / innerBlockRefs are the Svelte keyed-each source and the
 * component-ref slot array; structural mutations route through the commit
 * primitives on UndoController (commitContainerStructural / commitMultiScope),
 * which apply StructuralChange descriptors to keep ids/refs aligned with
 * children.
 */

import type { BlockComponent } from '../block-component';
import type { CstNode } from '../core/nodes';
import { assignIds } from '../tree-operations/block-id';
import { registerBlockListState } from './state-registry';

export interface BlockListState {
	innerBlockIds: string[];
	innerBlockRefs: (BlockComponent | undefined)[];
}

/**
 * `getNode` must be a live getter — by-value would freeze on the initial node
 * and miss undo's deep-clone reassignment.
 */
export function createBlockListState(getNode: () => CstNode): BlockListState {
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

	// Sync registration so callers outside a reactive context (unit tests) see
	// the entry on creation.
	registerBlockListState(initialNode, state);

	// Re-register on node-identity changes (undo replaces nodes via deep clone).
	$effect(() => {
		const node = getNode();
		if (!node.childIds) {
			node.childIds = assignIds(node.children ?? []);
		}
		registerBlockListState(node, state);
	});

	return state;
}
