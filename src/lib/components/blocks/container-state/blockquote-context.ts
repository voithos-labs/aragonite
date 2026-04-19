/**
 * Factory for BlockquoteBlock's override bundle — the Enter-on-empty-last-
 * child exit and the Rule U2 unwrap. Peer of createListContext; lives under
 * container-state/ alongside the state it reaches into.
 *
 * Returns the override map expected by `createStandardNestedActions`'s third
 * argument — callers pass it through directly.
 */

import { tick } from 'svelte';
import type {
	BlockEditActions,
	FocusActions,
	ContainerEditActions,
	CstNode
} from '../../../contracts';
import { displayLength } from '../../../core/lines';
import { deleteNode as performDelete } from '../../../tree-operations/node-ops';
import { unwrapFirstChildFromBlockquote } from '../../../tree-operations/blockquote';
import { rebuildBlockquoteRaw } from '../../../tree-operations/container-raw';
import type { BlockListState } from './block-list-state.svelte';
import type { NestedActionsBundle } from './nested-actions';

export interface BlockquoteContextDeps {
	get index(): number;
	get node(): CstNode;
	state: BlockListState;
	parentBlockEdit: BlockEditActions;
	parentFocus: FocusActions;
	parentContainerEdit: ContainerEditActions | undefined;
}

export function createBlockquoteOverrides(deps: BlockquoteContextDeps) {
	return (defaults: NestedActionsBundle) => ({
		blockEdit: {
			// Empty trailing-paragraph Enter exits the blockquote (creates a
			// paragraph after it) instead of appending another inner line.
			splitBlock: async (innerIndex: number, offset: number): Promise<void> => {
				const { node, index, state, parentBlockEdit, parentFocus, parentContainerEdit } = deps;
				if (!node.children) return;
				const child = node.children[innerIndex];
				const isLastChild = innerIndex === node.children.length - 1;
				const isEmpty = child.kind === 'paragraph' && child.raw.trim() === '';
				if (isLastChild && isEmpty) {
					if (node.children.length <= 1) {
						parentBlockEdit.splitBlock(index, displayLength(node.raw));
					} else {
						parentContainerEdit?.beginContainerEdit(index, 0);
						state.commitChildrenEdit((children, ids, refs) => {
							performDelete({ children }, ids, innerIndex);
							refs.splice(innerIndex, 1);
						});
						rebuildBlockquoteRaw(node);
						parentContainerEdit?.endContainerEdit();
						await tick();
						parentFocus.moveFocus(index + 1, 'start');
					}
					return;
				}
				return defaults.blockEdit.splitBlock(innerIndex, offset);
			},

			// Rule U2: Backspace at the start of the first child lifts that
			// child out of the blockquote. The factory default would delegate
			// upward and merge the whole blockquote with its previous sibling —
			// the wrong thing for U2.
			mergeWithPrevious: async (innerIndex: number): Promise<void> => {
				const { node, index, parentBlockEdit } = deps;
				if (!node.children) return;
				if (innerIndex <= 0) {
					const replacement = unwrapFirstChildFromBlockquote(node);
					if (replacement.length === 0) return;
					await parentBlockEdit.replaceBlock(index, replacement, {
						replacementIndex: 0,
						offset: 0
					});
					return;
				}
				return defaults.blockEdit.mergeWithPrevious(innerIndex);
			}
		}
	});
}
