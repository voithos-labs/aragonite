/**
 * Override factory for BlockquoteBlock — the Enter-on-empty-last-child exit.
 * Returns the override map.
 * Backspace unwrap (U2) is declaration-driven — the blockquote's `unwrapRole`
 * selects strategies in `unwrap-strategies.ts`.
 */

import type { BlockEditActions, FocusActions } from '../action-contracts';
import type { NodeView } from '../core/node-views';
import { displayLength } from '../core/lines';
import { deleteNode as performDelete } from '../tree-operations/node-ops';
import type { BlockListState } from '../reactivity/block-list-state.svelte';
import type { NestedActionsBundle } from './nested/nested-actions';
import type { UndoController } from './deps';

export interface BlockquoteOverridesDeps {
	get index(): number;
	get node(): NodeView;
	get path(): number[];
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
				const { node, index, state, parentBlockEdit, parentFocus } = deps;
				if (!node.children) return;
				const child = node.children[innerIndex];
				const isLastChild = innerIndex === node.children.length - 1;
				const isEmpty = child.kind === 'paragraph' && child.raw.trim() === '';
				if (isLastChild && isEmpty) {
					if (node.children.length <= 1) {
						await parentBlockEdit.splitBlock(index, displayLength(node.raw));
					} else {
						// The primitive's spine rebuild refreshes this quote's raw AND
						// its ancestors' (a nested quote's own rebuild alone would
						// strand an empty `> >` in the outer raw).
						await deps.controller.commitMultiScope({
							scopes: [{ node, state, path: deps.path }],
							snapshot: { path: [...deps.path, innerIndex], offset: 0 },
							mutate: ([scope]) => [performDelete(scope, innerIndex, scope.sharing)],
							op: {
								kind: 'delete',
								detail: { action: 'blockquoteExit', innerIndex },
								eventPath: [...deps.path]
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
