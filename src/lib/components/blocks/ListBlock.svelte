<script lang="ts">
	import { getContext, setContext } from 'svelte';
	import {
		BLOCK_EDIT_KEY,
		FOCUS_KEY,
		CONTAINER_EDIT_KEY,
		CONTROLLER_KEY,
		STICKY_COLUMN_KEY,
		LIST_CONTEXT_KEY,
		CURSOR_END,
		FOCUS_LAST_START,
		type BlockEditActions,
		type FocusActions,
		type ContainerEditActions,
		type StickyColumnDirection,
		type ListContext,
		type CstNode,
		type BlockComponent
	} from '../../contracts';
	import type { UndoController } from '../../editor-actions/deps';
	import type { StickyColumnState } from '../../cursor/sticky-column';
	import {
		deleteNode as performDelete,
		unwrapFirstItemFromList,
		mergeListItemIntoPrevious,
		renumberOrderedList,
		isItemUserEmpty,
		normalizeReplacementTrivia
	} from '../../tree-operations';
	import { parseAllInlineContent } from '../../core/inline';
	import { rebuildListRaw } from '../../schema/container-raw';
	import { createListContext } from '../../editor-actions/list-context';
	import { createBlockListState } from '../../reactivity/block-list-state.svelte';
	import {
		createStandardNestedActions,
		setNestedActionsContexts
	} from '../../editor-actions/nested-actions';
	import { dispatchFocusByPath, dispatchFocusAtColumn } from '../../editor-actions/focus-dispatch';
	import ListItemBlock from './ListItemBlock.svelte';

	let { node, index, myPath = [] }: { node: CstNode; index: number; myPath?: number[] } = $props();

	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const parentFocus = getContext<FocusActions>(FOCUS_KEY);
	const parentContainerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const controller = getContext<UndoController>(CONTROLLER_KEY);
	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);

	const state = createBlockListState(() => node);

	// Read parent context before the setContext below shadows it; captured for the override factory.
	const parentListContext = getContext<ListContext | undefined>(LIST_CONTEXT_KEY);

	const bundle = createStandardNestedActions(
		state,
		{
			get index() {
				return index;
			},
			get node() {
				return node;
			},
			rebuildRaw: () => rebuildListRaw(node),
			stickyColumn,
			parent: {
				blockEdit: parentBlockEdit,
				focus: parentFocus,
				containerEdit: parentContainerEdit
			}
		},
		() => ({
			blockEdit: {
				// Structural ops at list-wrapper level are owned by the individual ListItemBlocks.
				splitBlock: async (): Promise<void> => {},
				updateBlockContent: (): void => {},
				insertParsedBlocks: async (): Promise<void> => {},

				// Forward-delete is a no-op between items (structural peers, not text-mergeable).
				// For the LAST item, delegate upward so the following block merges into this list's deepest leaf.
				mergeWithNext: async (itemIndex: number): Promise<void> => {
					if (!node.children) return;
					if (itemIndex >= node.children.length - 1) {
						await parentBlockEdit.mergeWithNext(index);
					}
				},

				// Core list Backspace behavior: U1 unwrap / M1 merge / empty-item delete.
				mergeWithPrevious: async (itemIndex: number): Promise<void> => {
					if (!node.children) return;

					if (itemIndex <= 0) {
						// Nested list: promote the first item to parent level (like Shift+Tab).
						if (parentListContext) {
							await parentListContext.promoteNestedItem(
								parentListContext.getContainingItemIndex(),
								node,
								0
							);
							return;
						}

						const item = node.children[0];
						const firstChildEmpty = isItemUserEmpty(item);

						if (firstChildEmpty && node.children.length > 1) {
							// Empty first item with siblings — delete just the item.
							await parentContainerEdit.commitContainer({
								containerNode: node,
								state,
								snapshot: { blockIndex: index, offset: 0 },
								mutate: (children) => {
									const change = performDelete({ children }, 0);
									node.children = children;
									renumberOrderedList(node, 0);
									rebuildListRaw(node);
									return change;
								},
								op: { kind: 'delete', eventPath: [index, 0] },
								afterTick: () => {
									state.innerBlockRefs[0]?.focus(0);
								}
							});
						} else if (firstChildEmpty && node.children.length === 1) {
							// Empty only item — delete the list, focus block before it.
							await parentBlockEdit.deleteBlock(index);
							parentFocus.moveFocus(index - 1, 'end');
						} else {
							// Non-empty first item — Rule U1: unwrap out of the list.
							const replacement = unwrapFirstItemFromList(node);
							if (replacement.length === 0) return;
							await parentBlockEdit.replaceBlock(index, replacement, {
								replacementIndex: 0,
								offset: 0
							});
						}
						return;
					}

					const item = node.children[itemIndex];
					if (isItemUserEmpty(item)) {
						// Empty non-first item — delete it, renumber, focus previous end.
						await parentContainerEdit.commitContainer({
							containerNode: node,
							state,
							snapshot: { blockIndex: index, offset: 0 },
							mutate: (children) => {
								const change = performDelete({ children }, itemIndex);
								node.children = children;
								renumberOrderedList(node, itemIndex);
								rebuildListRaw(node);
								return change;
							},
							op: { kind: 'delete', eventPath: [index, itemIndex] },
							afterTick: () => {
								state.innerBlockRefs[itemIndex - 1]?.focus(CURSOR_END);
							}
						});
						return;
					}

					// Rule M1: merge into deepest visible text above with preserve-absolute-indent child placement.
					let mergePoint!: { targetPath: number[]; offset: number };
					await parentContainerEdit.commitContainer({
						containerNode: node,
						state,
						snapshot: { blockIndex: index, offset: 0 },
						mutate: (children) => {
							const result = mergeListItemIntoPrevious(node, children, itemIndex);
							mergePoint = result.mergePoint;
							// mergeListItemIntoPrevious removes itemIndex from children.
							return { op: 'delete', at: itemIndex, count: 1 };
						},
						op: {
							kind: 'merge',
							detail: { direction: 'prev' },
							eventPath: [index, itemIndex]
						},
						afterTick: () => {
							const [firstPathIdx, ...restPath] = mergePoint.targetPath;
							state.innerBlockRefs[firstPathIdx]?.focusByPath?.(restPath, mergePoint.offset);
						}
					});
				},

				deleteBlock: async (itemIndex: number): Promise<void> => {
					if (!node.children) return;
					if (node.children.length <= 1) {
						await parentBlockEdit.deleteBlock(index);
						return;
					}
					await parentContainerEdit.commitContainer({
						containerNode: node,
						state,
						snapshot: { blockIndex: index, offset: 0 },
						mutate: (children) => {
							const change = performDelete({ children }, itemIndex);
							node.children = children;
							rebuildListRaw(node);
							return change;
						},
						op: { kind: 'delete', eventPath: [index, itemIndex] },
						afterTick: () => {
							const focusIdx = Math.min(itemIndex, (node.children?.length ?? 1) - 1);
							state.innerBlockRefs[focusIdx]?.focus(0);
						}
					});
				},

				// U1/U2 typically replace on the list's parent; this list-level path is rare but symmetric.
				// Normalizes trivia and re-parses inline content so prose replacements keep their inline cache.
				replaceBlock: async (
					itemIndex: number,
					replacement: CstNode[],
					focus?: { replacementIndex: number; offset: number },
					options?: { skipSnapshot?: boolean }
				): Promise<void> => {
					if (!node.children || itemIndex < 0 || itemIndex >= node.children.length) return;

					const snapshot = options?.skipSnapshot
						? ('skip' as const)
						: { blockIndex: index, offset: 0 };

					await parentContainerEdit.commitContainer({
						containerNode: node,
						state,
						snapshot,
						mutate: (children) => {
							if (replacement.length === 0) {
								children.splice(itemIndex, 1);
								node.children = children;
								rebuildListRaw(node);
								return { op: 'delete', at: itemIndex, count: 1 };
							}
							const normalizedReplacement = normalizeReplacementTrivia(
								children[itemIndex],
								replacement
							);
							parseAllInlineContent(normalizedReplacement);
							children.splice(itemIndex, 1, ...normalizedReplacement);
							node.children = children;
							rebuildListRaw(node);
							return {
								op: 'replace',
								at: itemIndex,
								count: 1,
								newCount: normalizedReplacement.length
							};
						},
						op: {
							kind: replacement.length === 0 ? 'delete' : 'replaceBlock',
							detail: { count: replacement.length },
							eventPath: [index, itemIndex]
						},
						afterTick: () => {
							if (focus && replacement.length > 0) {
								const targetIdx = itemIndex + focus.replacementIndex;
								state.innerBlockRefs[targetIdx]?.focus(focus.offset);
							}
						}
					});
				}
			}
		})
	);

	setNestedActionsContexts(bundle);

	const listContext = createListContext({
		get index() {
			return index;
		},
		get node() {
			return node;
		},
		state,
		parentBlockEdit,
		parentFocus,
		parentListContext,
		controller
	});

	setContext(LIST_CONTEXT_KEY, listContext);

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	export function focus(offset: number): void {
		if (!node.children || node.children.length === 0) return;
		if (offset === FOCUS_LAST_START) {
			// Focus last descendant at start — cascade sentinel through nested containers
			const last = node.children.length - 1;
			state.innerBlockRefs[last]?.focus(FOCUS_LAST_START);
		} else if (offset === 0) {
			state.innerBlockRefs[0]?.focus(0);
		} else {
			const last = node.children.length - 1;
			state.innerBlockRefs[last]?.focus(CURSOR_END);
		}
	}

	export function getCursorOffset(): number | null {
		for (const ref of state.innerBlockRefs) {
			const offset = ref?.getCursorOffset();
			if (offset !== null && offset !== undefined) return offset;
		}
		return null;
	}

	export function focusByPath(path: number[], offset: number): void {
		dispatchFocusByPath(state.innerBlockRefs, path, offset);
	}

	export function focusAtColumn(x: number, from: StickyColumnDirection): void {
		if (!node.children || node.children.length === 0) return;
		dispatchFocusAtColumn(state.innerBlockRefs, x, from);
	}

	void ({
		editable,
		focusable,
		focus,
		getCursorOffset,
		focusByPath,
		focusAtColumn
	} satisfies BlockComponent);
</script>

<div class="list-block">
	{#each node.children ?? [] as item, i (state.innerBlockIds[i])}
		<ListItemBlock
			node={item}
			index={i}
			myPath={[...myPath, i]}
			bind:this={state.innerBlockRefs[i]}
		/>
	{/each}
</div>

<style>
	.list-block {
		margin: 4px 0;
		padding-left: 0;
		list-style: none;
	}
</style>
