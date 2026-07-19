/**
 * Override factory for ListBlock — list-wrapper-level structural overrides
 * that ListBlock layers over the standard nested actions bundle: item-level
 * no-ops, last-item forward-merge delegation, item delete, and item replace.
 * Backspace unwrap (U1/M1) is declaration-driven — the list's `unwrapRole`
 * selects strategies in `unwrap-strategies.ts`.
 */

import type { BlockEditActions, ContainerEditActions, UndoEntryMode } from '../action-contracts';
import type { CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { deleteNode as performDelete, normalizeReplacementTrivia } from '../tree-operations';
import {
	replacePreservingFirst,
	stampStructuralChange
} from '../tree-operations/structural-change';
import type { BlockListState } from '../reactivity/block-list-state.svelte';
import type { NestedActionsOverrideFactory } from './nested/nested-actions';

export interface ListOverridesDeps {
	get index(): number;
	get node(): NodeView;
	get path(): number[];
	state: BlockListState;
	parentBlockEdit: BlockEditActions;
	parentContainerEdit: ContainerEditActions;
}

export function createListOverrides(deps: ListOverridesDeps): NestedActionsOverrideFactory {
	return () => ({
		blockEdit: {
			splitBlock: async (): Promise<void> => {},
			updateBlockContent: (): void => {},
			insertParsedBlocks: async (): Promise<void> => {},

			// Forward-delete is a no-op between items (structural peers, not text-mergeable).
			// For the LAST item, delegate upward so the following block merges into this list's deepest leaf.
			mergeWithNext: async (itemIndex: number): Promise<void> => {
				const node = deps.node;
				if (!node.children) return;
				if (itemIndex >= node.children.length - 1) {
					await deps.parentBlockEdit.mergeWithNext(deps.index);
				}
			},

			deleteBlock: async (itemIndex: number): Promise<void> => {
				const node = deps.node;
				const index = deps.index;
				if (!node.children) return;
				if (node.children.length <= 1) {
					await deps.parentBlockEdit.deleteBlock(index);
					return;
				}
				await deps.parentContainerEdit.commitContainer({
					containerNode: node,
					path: deps.path,
					state: deps.state,
					snapshot: { path: [...deps.path, itemIndex], offset: 0 },
					mutate: (scope) => performDelete({ children: scope.children }, itemIndex, scope.sharing),
					op: { kind: 'delete', eventPath: [...deps.path, itemIndex] },
					afterTick: () => {
						// Read through `deps.node`: the captured `node` is the pre-commit
						// object the snapshot still shares, so its child count is stale by
						// +1 after the delete (mirrors table-context's deleteRow rule).
						const focusIdx = Math.min(itemIndex, (deps.node.children?.length ?? 1) - 1);
						deps.state.innerBlockRefs[focusIdx]?.focus(0);
					}
				});
			},

			// U1/U2 typically replace on the list's parent; this list-level path is rare but symmetric.
			replaceBlock: async (
				itemIndex: number,
				replacement: CstNode[],
				focus?: { replacementIndex: number; offset: number },
				options?: { undoEntry?: UndoEntryMode }
			): Promise<void> => {
				const node = deps.node;
				if (!node.children || itemIndex < 0 || itemIndex >= node.children.length) return;

				const snapshot =
					options?.undoEntry === 'join'
						? ('skip' as const)
						: { path: [...deps.path, itemIndex], offset: 0 };

				await deps.parentContainerEdit.commitContainer({
					containerNode: node,
					path: deps.path,
					state: deps.state,
					snapshot,
					mutate: (scope) => {
						if (replacement.length === 0) {
							scope.children.splice(itemIndex, 1);
							return { op: 'delete', at: itemIndex, count: 1 };
						}
						const normalizedReplacement = normalizeReplacementTrivia(
							scope.children[itemIndex],
							replacement
						);
						scope.children.splice(itemIndex, 1, ...normalizedReplacement);
						const change = replacePreservingFirst(itemIndex, 1, normalizedReplacement.length);
						stampStructuralChange(scope.children, change, scope.sharing);
						return change;
					},
					op:
						replacement.length === 0
							? { kind: 'delete', eventPath: [...deps.path, itemIndex] }
							: {
									kind: 'replaceBlock',
									detail: { count: replacement.length },
									eventPath: [...deps.path, itemIndex]
								},
					afterTick: () => {
						if (focus && replacement.length > 0) {
							const targetIdx = itemIndex + focus.replacementIndex;
							deps.state.innerBlockRefs[targetIdx]?.focus(focus.offset);
						}
					}
				});
			}
		}
	});
}
