<script lang="ts">
	import { getContext, setContext } from 'svelte';
	import {
		BLOCK_EDIT_KEY,
		FOCUS_KEY,
		CONTAINER_EDIT_KEY,
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
	import type { StickyColumnState } from '../../contenteditable/sticky-column';
	import { generateBlockId } from '../../tree-operations/block-id';
	import {
		deleteNode as performDelete,
		unwrapFirstItemFromList,
		mergeListItemIntoPrevious,
		renumberOrderedList,
		isItemUserEmpty,
		normalizeReplacementTrivia
	} from '../../tree-operations';
	import { parseAllInlineContent } from '../../core/inline';
	import { rebuildListRaw } from '../../tree-operations/container-raw';
	import { createListContext } from './container-state/list-context';
	import { createBlockListState } from './container-state/block-list-state.svelte';
	import {
		createStandardNestedActions,
		setNestedActionsContexts
	} from './container-state/nested-actions';
	import { dispatchFocusByPath, dispatchFocusAtColumn } from './container-state/focus-dispatch';
	import ListItemBlock from './ListItemBlock.svelte';

	let { node, index, myPath = [] }: { node: CstNode; index: number; myPath?: number[] } = $props();

	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const parentFocus = getContext<FocusActions>(FOCUS_KEY);
	const parentContainerEdit = getContext<ContainerEditActions | undefined>(CONTAINER_EDIT_KEY);
	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);

	const state = createBlockListState(() => node);

	// Read the parent list context BEFORE `setContext(LIST_CONTEXT_KEY, ...)`
	// later in the file shadows it. For nested lists this returns the outer
	// list's context; for top-level lists it is undefined. Captured here so
	// the override factory below can close over it.
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
				// Structural ops at the list-wrapper level are handled by the
				// individual ListItemBlock components, not the list itself.
				splitBlock: async (): Promise<void> => {},
				updateBlockContent: (): void => {},
				insertParsedBlocks: async (): Promise<void> => {},

				// Forward-delete at end of an inner item is a no-op (list items
				// are structural peers, not text-mergeable). For the LAST item,
				// delegate upward so the cross-container merge handler can merge
				// the following block into the list's deepest prose leaf.
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
							await parentContainerEdit!.commitContainer(
								node,
								state,
								{ blockIndex: index, offset: 0 },
								(children, ids, refs) => {
									performDelete({ children }, ids, 0);
									refs.splice(0, 1);
									node.children = children;
									renumberOrderedList(node, 0);
									rebuildListRaw(node);
								},
								() => {
									state.innerBlockRefs[0]?.focus(0);
								},
								{ kind: 'delete', eventPath: [index, 0] }
							);
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
						await parentContainerEdit!.commitContainer(
							node,
							state,
							{ blockIndex: index, offset: 0 },
							(children, ids, refs) => {
								performDelete({ children }, ids, itemIndex);
								refs.splice(itemIndex, 1);
								node.children = children;
								renumberOrderedList(node, itemIndex);
								rebuildListRaw(node);
							},
							() => {
								state.innerBlockRefs[itemIndex - 1]?.focus(CURSOR_END);
							},
							{ kind: 'delete', eventPath: [index, itemIndex] }
						);
						return;
					}

					// Non-empty item — Rule M1: merge into deepest visible text above
					// (rule B) with preserve-absolute-indent child placement.
					// The op now accepts the commit's caller-owned children copy directly,
					// so no post-call sync dance is needed (that was the Bug A workaround).
					let mergePoint!: { targetPath: number[]; offset: number };
					await parentContainerEdit!.commitContainer(
						node,
						state,
						{ blockIndex: index, offset: 0 },
						(children, ids, refs) => {
							const result = mergeListItemIntoPrevious(node, children, itemIndex);
							mergePoint = result.mergePoint;
							ids.splice(itemIndex, 1);
							refs.splice(itemIndex, 1);
						},
						() => {
							const [firstPathIdx, ...restPath] = mergePoint.targetPath;
							state.innerBlockRefs[firstPathIdx]?.focusByPath?.(restPath, mergePoint.offset);
						},
						{
							kind: 'merge',
							detail: { direction: 'prev' },
							eventPath: [index, itemIndex]
						}
					);
				},

				// Delete an item; if it was the only item, delete the whole list.
				deleteBlock: async (itemIndex: number): Promise<void> => {
					if (!node.children) return;
					if (node.children.length <= 1) {
						parentBlockEdit.deleteBlock(index);
						return;
					}
					await parentContainerEdit!.commitContainer(
						node,
						state,
						{ blockIndex: index, offset: 0 },
						(children, ids, refs) => {
							performDelete({ children }, ids, itemIndex);
							refs.splice(itemIndex, 1);
							node.children = children;
							rebuildListRaw(node);
						},
						() => {
							const focusIdx = Math.min(itemIndex, (node.children?.length ?? 1) - 1);
							state.innerBlockRefs[focusIdx]?.focus(0);
						},
						{ kind: 'delete', eventPath: [index, itemIndex] }
					);
				},

				// Splice replacement items. U1 and U2 typically replace on a parent
				// that contains the list, not on the list itself — this path is
				// rare but kept for symmetry. Uses normalizeReplacementTrivia +
				// parseAllInlineContent so prose replacements don't drop their
				// inline cache, matching the other two replaceBlock paths.
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

					await parentContainerEdit!.commitContainer(
						node,
						state,
						snapshot,
						(children, ids, refs) => {
							if (replacement.length === 0) {
								children.splice(itemIndex, 1);
								ids.splice(itemIndex, 1);
								refs.splice(itemIndex, 1);
							} else {
								const normalizedReplacement = normalizeReplacementTrivia(
									children[itemIndex],
									replacement
								);
								parseAllInlineContent(normalizedReplacement);
								children.splice(itemIndex, 1, ...normalizedReplacement);
								ids.splice(itemIndex, 1, ...normalizedReplacement.map(() => generateBlockId()));
								refs.splice(
									itemIndex,
									1,
									...new Array(normalizedReplacement.length).fill(undefined)
								);
							}
							node.children = children;
							rebuildListRaw(node);
						},
						() => {
							if (focus && replacement.length > 0) {
								const targetIdx = itemIndex + focus.replacementIndex;
								state.innerBlockRefs[targetIdx]?.focus(focus.offset);
							}
						},
						{
							kind: replacement.length === 0 ? 'delete' : 'replaceBlock',
							detail: { count: replacement.length },
							eventPath: [index, itemIndex]
						}
					);
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
		parentContainerEdit,
		parentListContext
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

	/**
	 * Cascade focus down a path of child indices to land a cursor at `offset`
	 * in the target leaf block. Used by M1 merge to position the cursor at
	 * the merge point inside a potentially-nested list item.
	 *
	 * A path of `[]` means "this list itself" — we treat that as focus at
	 * offset 0 of the first item for safety; this should not happen in
	 * practice because M1 always provides a non-empty path.
	 */
	export function focusByPath(path: number[], offset: number): void {
		dispatchFocusByPath(state.innerBlockRefs, path, offset);
	}

	/**
	 * Position the cursor at the offset nearest to editor-relative pixel X
	 * inside this list's first (from='above') or last (from='below') item.
	 * Delegates to the child item's focusAtColumn? if available, else falls
	 * back to focus(0) / focus(CURSOR_END). List itself does no pixel math —
	 * it just picks the right item and forwards.
	 */
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
