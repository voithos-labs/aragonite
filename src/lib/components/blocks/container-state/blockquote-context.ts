/**
 * Factory for BlockquoteBlock's override bundle — the Enter-on-empty-last-
 * child exit and the Rule U2 unwrap. Peer of createListContext; lives under
 * container-state/ alongside the state it reaches into.
 *
 * Returns the override map expected by `createStandardNestedActions`'s third
 * argument — callers pass it through directly.
 */

import { tick } from 'svelte';
import type { BlockEditActions, FocusActions, CstNode } from '../../../contracts';
import { displayLength } from '../../../core/lines';
import { deleteNode as performDelete } from '../../../tree-operations/node-ops';
import { unwrapFirstChildFromBlockquote } from '../../../tree-operations/blockquote';
import { rebuildBlockquoteRaw } from '../../../tree-operations/container-raw';
import type { BlockListState } from './block-list-state.svelte';
import type { NestedActionsBundle } from './nested-actions';
import type { UndoController } from '../../editor-actions/deps';

export interface BlockquoteContextDeps {
	get index(): number;
	get node(): CstNode;
	state: BlockListState;
	parentBlockEdit: BlockEditActions;
	parentFocus: FocusActions;
	controller: UndoController;
}

export function createBlockquoteOverrides(deps: BlockquoteContextDeps) {
	return (defaults: NestedActionsBundle) => ({
		blockEdit: {
			// Enter on an empty trailing paragraph exits the blockquote instead of
			// appending another inner line.
			splitBlock: async (innerIndex: number, offset: number): Promise<void> => {
				const { node, index, state, parentBlockEdit, parentFocus } = deps;
				if (!node.children) return;
				const child = node.children[innerIndex];
				const isLastChild = innerIndex === node.children.length - 1;
				const isEmpty = child.kind === 'paragraph' && child.raw.trim() === '';
				if (isLastChild && isEmpty) {
					if (node.children.length <= 1) {
						parentBlockEdit.splitBlock(index, displayLength(node.raw));
					} else {
						await deps.controller.commitMultiScope(
							[{ node, state }],
							{ blockIndex: index, offset: 0 },
							(scopeChildren) => {
								const change = performDelete(scopeChildren[0], innerIndex);
								// Sync node.children before rebuild — rebuildBlockquoteRaw reads it directly.
								node.children = scopeChildren[0].children;
								rebuildBlockquoteRaw(node);
								return [change];
							},
							{
								kind: 'delete',
								detail: { action: 'blockquoteExit', innerIndex },
								eventPath: [index]
							}
						);
						await tick();
						parentFocus.moveFocus(index + 1, 'start');
					}
					return;
				}
				return defaults.blockEdit.splitBlock(innerIndex, offset);
			},

			// Rule U2: Backspace at first child lifts it out of the blockquote.
			// The factory default would delegate upward and merge the whole blockquote.
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
