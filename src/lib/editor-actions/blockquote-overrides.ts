/**
 * Override factory for BlockquoteBlock: the Enter-on-empty-last-child exit.
 * Backspace unwrap (U2) is declaration-driven — the blockquote's `unwrapRole`
 * selects strategies in `unwrap-strategies.ts`.
 */

import type { BlockEditActions, FocusActions } from '../action-contracts';
import { displayLength } from '../core/lines';
import { deleteNode as performDelete } from '../tree-operations/node-ops';
import type { BlockListState } from '../reactivity/block-list-state.svelte';
import type { NestedActionsBundle, NodeScope } from './nested/nested-actions';
import type { UndoController } from './deps';
import { extendDocPath, docPathFrom } from '../cursor/coordinate-spaces';

export interface BlockquoteOverridesDeps {
	scope: NodeScope;
	state: BlockListState;
	parentBlockEdit: BlockEditActions;
	parentFocus: FocusActions;
	controller: UndoController;
}

export function createBlockquoteOverrides(deps: BlockquoteOverridesDeps) {
	return (defaults: NestedActionsBundle) => ({
		blockEdit: {
			// Enter on an empty trailing paragraph exits the blockquote instead of
			// appending another inner line.
			splitBlock: async (innerIndex: number, offset: number): Promise<void> => {
				const { state, parentBlockEdit, parentFocus } = deps;
				const { node, index, path } = deps.scope;
				if (!node.children) return;
				const child = node.children[innerIndex];
				const isLastChild = innerIndex === node.children.length - 1;
				const isEmpty = child.kind === 'paragraph' && child.raw.trim() === '';
				if (isLastChild && isEmpty) {
					if (node.children.length <= 1) {
						await parentBlockEdit.splitBlock(index, displayLength(node.raw));
					} else {
						// The primitive's spine rebuild refreshes this quote's raw AND its
						// ancestors' — a nested quote's own rebuild would strand `> >` outside.
						await deps.controller.commitMultiScope({
							scopes: [{ node, state, path }],
							snapshot: { path: extendDocPath(path, innerIndex), offset: 0 },
							mutate: ([scope]) => [performDelete(scope, innerIndex, scope.sharing)],
							op: {
								kind: 'delete',
								detail: { action: 'blockquoteExit', innerIndex },
								eventPath: docPathFrom(path)
							},
							afterTick: () => {
								void parentFocus.moveFocus(index + 1, 'start');
							}
						});
					}
					return;
				}
				return defaults.blockEdit.splitBlock(innerIndex, offset);
			}
		}
	});
}
