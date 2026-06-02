/**
 * Override factory for BlockquoteBlock — Enter-on-empty-last-child exit plus
 * the Rule U2 unwrap. Returns the override map consumed by
 * `createStandardNestedActions`.
 */

import type { BlockEditActions, FocusActions } from '../action-contracts';
import type { CstNode, Document } from '../core/nodes';
import { displayLength } from '../core/lines';
import { deleteNode as performDelete } from '../tree-operations/node-ops';
import { unwrapFirstChildFromBlockquote } from '../tree-operations/blockquote';
import { rebuildBlockquoteRaw, rebuildAncestryRawForLeaf } from '../schema/container-raw';
import type { BlockListState } from '../reactivity/block-list-state.svelte';
import type { NestedActionsBundle } from './nested-actions';
import type { UndoController } from './deps';

export interface BlockquoteContextDeps {
	get index(): number;
	get node(): CstNode;
	get path(): number[];
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
						await deps.controller.commitMultiScope({
							scopes: [{ node, state }],
							snapshot: { blockIndex: index, offset: 0 },
							mutate: (scopeChildren) => {
								const change = performDelete(scopeChildren[0], innerIndex);
								// Sync before rebuild — rebuildBlockquoteRaw reads node.children directly.
								node.children = scopeChildren[0].children;
								rebuildBlockquoteRaw(node);
								// A nested quote's own raw rebuild doesn't reach its ancestors;
								// without this the outer quote's raw keeps the deleted line's
								// `> ` continuation and the source strands an empty `> >`.
								const doc = deps.controller.getDocScope().node as unknown as Document;
								rebuildAncestryRawForLeaf(doc, deps.path);
								return [change];
							},
							op: {
								kind: 'delete',
								detail: { action: 'blockquoteExit', innerIndex },
								eventPath: [index]
							},
							afterTick: () => {
								parentFocus.moveFocus(index + 1, 'start');
							}
						});
					}
					return;
				}
				return defaults.blockEdit.splitBlock(innerIndex, offset);
			},

			// Rule U2: Backspace at first child lifts it out. Without this override,
			// the default would delegate upward and merge the whole blockquote.
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
