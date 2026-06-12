/**
 * Override factory for ListBlock — list-wrapper-level structural overrides
 * that ListBlock layers over the standard nested actions bundle: U1 unwrap,
 * M1 merge into deepest leaf, empty-item delete, last-item forward-merge
 * delegation, and item replace.
 */

import type {
	BlockEditActions,
	ContainerEditActions,
	FocusActions,
	ListContext,
	UndoEntryMode
} from '../action-contracts';
import { CURSOR_END } from '../block-component';
import type { CstNode } from '../core/nodes';
import {
	deleteNode as performDelete,
	unwrapFirstItemFromList,
	mergeListItemIntoPrevious,
	renumberOrderedList,
	isItemUserEmpty,
	normalizeReplacementTrivia
} from '../tree-operations';
import {
	replacePreservingFirst,
	stampStructuralChange
} from '../tree-operations/structural-change';
import type { BlockListState } from '../reactivity/block-list-state.svelte';
import type { NestedActionsOverrideFactory } from './nested-actions';

export interface ListOverridesDeps {
	get index(): number;
	get node(): CstNode;
	get path(): number[];
	state: BlockListState;
	parentBlockEdit: BlockEditActions;
	parentContainerEdit: ContainerEditActions;
	parentFocus: FocusActions;
	parentListContext: ListContext | undefined;
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

			// Core list Backspace behavior: U1 unwrap / M1 merge / empty-item delete.
			mergeWithPrevious: async (itemIndex: number): Promise<void> => {
				const node = deps.node;
				const index = deps.index;
				if (!node.children) return;

				if (itemIndex <= 0) {
					if (deps.parentListContext) {
						await deps.parentListContext.promoteNestedItem(
							deps.parentListContext.getContainingItemIndex(),
							node,
							0
						);
						return;
					}

					const item = node.children[0];
					const firstChildEmpty = isItemUserEmpty(item);

					if (firstChildEmpty && node.children.length > 1) {
						await deps.parentContainerEdit.commitContainer({
							containerNode: node,
							path: deps.path,
							state: deps.state,
							snapshot: { blockIndex: index, offset: 0 },
							mutate: (scope) => {
								const change = performDelete({ children: scope.children }, 0, scope.sharing);
								renumberOrderedList(scope.node, 0, scope.sharing);
								return change;
							},
							op: { kind: 'delete', eventPath: [index, 0] },
							afterTick: () => {
								deps.state.innerBlockRefs[0]?.focus(0);
							}
						});
					} else if (firstChildEmpty && node.children.length === 1) {
						await deps.parentBlockEdit.deleteBlock(index);
						deps.parentFocus.moveFocus(index - 1, 'end');
					} else {
						const replacement = unwrapFirstItemFromList(node);
						if (replacement.length === 0) return;
						await deps.parentBlockEdit.replaceBlock(index, replacement, {
							replacementIndex: 0,
							offset: 0
						});
					}
					return;
				}

				const item = node.children[itemIndex];
				if (isItemUserEmpty(item)) {
					await deps.parentContainerEdit.commitContainer({
						containerNode: node,
						path: deps.path,
						state: deps.state,
						snapshot: { blockIndex: index, offset: 0 },
						mutate: (scope) => {
							const change = performDelete({ children: scope.children }, itemIndex, scope.sharing);
							renumberOrderedList(scope.node, itemIndex, scope.sharing);
							return change;
						},
						op: { kind: 'delete', eventPath: [index, itemIndex] },
						afterTick: () => {
							deps.state.innerBlockRefs[itemIndex - 1]?.focus(CURSOR_END);
						}
					});
					return;
				}

				// Rule M1: merge into deepest visible text above with preserve-absolute-indent child placement.
				let mergePoint!: { targetPath: number[]; offset: number };
				await deps.parentContainerEdit.commitContainer({
					containerNode: node,
					path: deps.path,
					state: deps.state,
					snapshot: { blockIndex: index, offset: 0 },
					mutate: (scope) => {
						const result = mergeListItemIntoPrevious(
							scope.node,
							scope.children,
							itemIndex,
							scope.sharing
						);
						mergePoint = result.mergePoint;
						return { op: 'delete', at: itemIndex, count: 1 };
					},
					op: {
						kind: 'merge',
						detail: { direction: 'prev' },
						eventPath: [index, itemIndex]
					},
					afterTick: () => {
						const [firstPathIdx, ...restPath] = mergePoint.targetPath;
						deps.state.innerBlockRefs[firstPathIdx]?.focusByPath?.(restPath, mergePoint.offset);
					}
				});
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
					snapshot: { blockIndex: index, offset: 0 },
					mutate: (scope) => performDelete({ children: scope.children }, itemIndex, scope.sharing),
					op: { kind: 'delete', eventPath: [index, itemIndex] },
					afterTick: () => {
						const focusIdx = Math.min(itemIndex, (node.children?.length ?? 1) - 1);
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
				const index = deps.index;
				if (!node.children || itemIndex < 0 || itemIndex >= node.children.length) return;

				const snapshot =
					options?.undoEntry === 'join' ? ('skip' as const) : { blockIndex: index, offset: 0 };

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
					op: {
						kind: replacement.length === 0 ? 'delete' : 'replaceBlock',
						detail: { count: replacement.length },
						eventPath: [index, itemIndex]
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
