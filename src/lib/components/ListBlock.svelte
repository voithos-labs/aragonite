<script lang="ts">
	import { getContext, setContext, tick } from 'svelte';
	import {
		EDITOR_ACTIONS_KEY,
		LIST_CONTEXT_KEY,
		LIST_PARENT_ITEM_INDEX_KEY,
		CURSOR_END,
		type EditorActions,
		type ListContext,
		type CstNode,
		type BlockComponent
	} from '../editor-types';
	import { assignIds, generateBlockId } from '../mutable-tree';
	import { deleteNode as performDelete } from '../tree-operations';
	import { rebuildListRaw, rebuildListItemRaw } from '../container-raw';
	import ListItemBlock from './ListItemBlock.svelte';

	let { node, index }: { node: CstNode; index: number } = $props();

	const parentActions = getContext<EditorActions>(EDITOR_ACTIONS_KEY);
	let itemBlockIds = $state<string[]>(assignIds(node.children ?? []));
	let itemBlockRefs = $state<(BlockComponent | undefined)[]>([]);

	// Re-sync item block IDs when children count changes externally (undo/redo)
	$effect(() => {
		const childCount = (node.children ?? []).length;
		if (childCount !== itemBlockIds.length) {
			itemBlockIds = assignIds(node.children ?? []);
		}
	});

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	export function focus(offset: number): void {
		if (!node.children || node.children.length === 0) return;
		if (offset === 0) {
			itemBlockRefs[0]?.focus?.(0);
		} else {
			const last = node.children.length - 1;
			itemBlockRefs[last]?.focus?.(CURSOR_END);
		}
	}

	export function getCursorOffset(): number | null {
		for (const ref of itemBlockRefs) {
			const offset = ref?.getCursorOffset?.();
			if (offset !== null && offset !== undefined) return offset;
		}
		return null;
	}

	// ── Helpers ─────────────────────────────────────────────────────────

	function rebuildAndNotify(): void {
		rebuildListRaw(node);
		parentActions.endContainerEdit?.();
	}

	function triggerItemReactivity(): void {
		node.children = [...(node.children ?? [])];
		itemBlockIds = [...itemBlockIds];
	}

	// ── List-level EditorActions ────────────────────────────────────────
	// Handles operations that cross list item boundaries.

	const listActions: EditorActions = {
		// splitBlock at list level: not applicable (list items handle their own splits)
		async splitBlock(): Promise<void> {},

		async mergeWithPrevious(itemIndex: number): Promise<void> {
			if (!node.children) return;

			if (itemIndex <= 0) {
				// At start of first list item — exit the list
				parentActions.moveFocus(index - 1, 'end');
				return;
			}

			// Check if current item is empty — if so, delete it
			const item = node.children[itemIndex];
			const isEmptyItem =
				item.children &&
				item.children.length === 1 &&
				item.children[0].kind === 'paragraph' &&
				item.children[0].raw.trim() === '';
			if (isEmptyItem) {
				parentActions.beginContainerEdit?.(index, 0);
				performDelete({ children: node.children }, itemBlockIds, itemIndex);
				rebuildListRaw(node);
				parentActions.endContainerEdit?.();
				triggerItemReactivity();
				await tick();
				itemBlockRefs[itemIndex - 1]?.focus?.(CURSOR_END);
				return;
			}

			// Non-empty item — move focus to end of previous item
			itemBlockRefs[itemIndex - 1]?.focus?.(CURSOR_END);
		},

		async deleteBlock(itemIndex: number): Promise<void> {
			if (!node.children) return;

			if (node.children.length <= 1) {
				// Last item — delete entire list
				parentActions.deleteBlock(index);
				return;
			}

			parentActions.beginContainerEdit?.(index, 0);
			performDelete({ children: node.children }, itemBlockIds, itemIndex);
			rebuildAndNotify();
			triggerItemReactivity();
			await tick();
			const focusIdx = Math.min(itemIndex, node.children.length - 1);
			itemBlockRefs[focusIdx]?.focus?.(0);
		},

		async moveFocus(itemIndex: number, position: 'start' | 'end' | number): Promise<void> {
			if (!node.children) return;

			if (itemIndex < 0) {
				parentActions.moveFocus(index - 1, 'end');
			} else if (itemIndex >= node.children.length) {
				parentActions.moveFocus(index + 1, 'start');
			} else {
				const item = itemBlockRefs[itemIndex];
				if (!item?.focusable) return;
				if (typeof position === 'number') item.focus?.(position);
				else if (position === 'start') item.focus?.(0);
				else item.focus?.(CURSOR_END);
			}
		},

		updateBlockContent(): void {
			// List items handle their own content updates
		},

		requestUndo(): void | Promise<void> {
			return parentActions.requestUndo();
		},

		requestRedo(): void | Promise<void> {
			return parentActions.requestRedo();
		},

		beginContainerEdit(_blockIndex: number, offset: number): void {
			parentActions.beginContainerEdit?.(index, offset);
		},

		beginContainerEditDebounced(_blockIndex: number, offset: number): void {
			parentActions.beginContainerEditDebounced?.(index, offset);
		},

		endContainerEdit(): void {
			rebuildListRaw(node);
			parentActions.endContainerEdit?.();
		}
	};

	setContext(EDITOR_ACTIONS_KEY, listActions);

	// ── List Context ────────────────────────────────────────────────────
	// Provides list-specific operations to child ListItemBlock components.
	// Read parent list context BEFORE setContext shadows it. For nested lists
	// this returns the outer list's context; for top-level lists it is undefined.
	const parentListContext = getContext<ListContext | undefined>(LIST_CONTEXT_KEY);
	const getParentItemIndex = getContext<(() => number) | undefined>(LIST_PARENT_ITEM_INDEX_KEY);

	const listContext: ListContext = {
		async indentItem(itemIndex: number): Promise<void> {
			if (!node.children || itemIndex === 0) return;

			const item = node.children[itemIndex];
			const prevItem = node.children[itemIndex - 1];
			if (!prevItem.children) return;

			parentActions.beginContainerEdit?.(index, 0);

			// Remove current item from this list
			node.children.splice(itemIndex, 1);
			itemBlockIds.splice(itemIndex, 1);

			// Check if prevItem already has a nested list of the same type
			const ordered = (node.metadata as { ordered: boolean }).ordered;
			const existingNestedList = prevItem.children.find(
				(c) =>
					c.kind === 'list' &&
					(c.metadata as { ordered: boolean }).ordered === ordered
			);

			if (existingNestedList && existingNestedList.children) {
				// Append to existing nested list
				existingNestedList.children.push(item);
				rebuildListRaw(existingNestedList);
			} else {
				// Create a new nested list with this item as its only child
				const nestedList: CstNode = {
					kind: 'list',
					leadingTrivia: '',
					raw: '',
					metadata: { ordered },
					children: [item]
				};
				rebuildListRaw(nestedList);
				prevItem.children.push(nestedList);
			}

			rebuildListItemRaw(prevItem);
			rebuildListRaw(node);
			parentActions.endContainerEdit?.();
			triggerItemReactivity();
			await tick();

			// Focus the indented item (now inside the previous item's nested list)
			itemBlockRefs[itemIndex - 1]?.focus?.(CURSOR_END);
		},

		async unindentItem(itemIndex: number): Promise<void> {
			if (!parentListContext || !getParentItemIndex || !node.children) return;
			// Delegate the full operation to the parent list, which has direct
			// access to its own children array and the parent item node.
			await parentListContext.promoteNestedItem(getParentItemIndex(), node, itemIndex);
		},

		async insertItemAfter(itemIndex: number, newItem?: CstNode): Promise<void> {
			if (!node.children) return;

			if (!newItem) {
				const prevMarker =
					(node.children[itemIndex]?.metadata as { marker?: string })?.marker ?? '- ';
				// For ordered lists, increment the number (e.g. "1. " → "2. ")
				const marker = prevMarker.replace(/^(\d+)/, (_, n) => String(Number(n) + 1));
				newItem = {
					kind: 'listItem',
					leadingTrivia: '',
					raw: '',
					metadata: { marker, taskItem: false, taskChecked: false },
					innerPrefix: '',
					children: [{ kind: 'paragraph', leadingTrivia: '', raw: '\n' }],
					innerSuffix: ''
				};
				rebuildListItemRaw(newItem);
			}

			node.children.splice(itemIndex + 1, 0, newItem);
			itemBlockIds.splice(itemIndex + 1, 0, generateBlockId());
			rebuildListRaw(node);
			triggerItemReactivity();
			await tick();
			itemBlockRefs[itemIndex + 1]?.focus?.(0);
		},

		async promoteNestedItem(
			parentItemIdx: number,
			nestedListNode: CstNode,
			nestedItemIdx: number
		): Promise<void> {
			if (!node.children || !nestedListNode.children) return;

			const parentItem = node.children[parentItemIdx];
			if (!parentItem?.children) return;

			parentActions.beginContainerEdit?.(index, 0);

			const item = nestedListNode.children[nestedItemIdx];

			// 1. Remove item from nested list
			nestedListNode.children.splice(nestedItemIdx, 1);

			// 2. If nested list is now empty, remove it from the parent item's children
			if (nestedListNode.children.length === 0) {
				const nestedIdx = parentItem.children.indexOf(nestedListNode);
				if (nestedIdx !== -1) {
					parentItem.children.splice(nestedIdx, 1);
				}
			} else {
				rebuildListRaw(nestedListNode);
			}

			// 3. Rebuild parent item raw
			rebuildListItemRaw(parentItem);

			// 4. Insert the promoted item into this list after the parent item
			node.children.splice(parentItemIdx + 1, 0, item);
			itemBlockIds.splice(parentItemIdx + 1, 0, generateBlockId());

			// 5. Rebuild this list's raw
			rebuildListRaw(node);
			parentActions.endContainerEdit?.();
			triggerItemReactivity();
			await tick();

			// Focus the promoted item
			itemBlockRefs[parentItemIdx + 1]?.focus?.(0);
		},

		async exitListAtItem(itemIndex: number): Promise<void> {
			if (!node.children) return;

			if (node.children.length <= 1) {
				// Only item — replace the list with an empty paragraph via split
				// Splitting at the end of raw creates a new empty block after
				let displayLen = node.raw.length;
				if (node.raw.endsWith('\r\n')) displayLen -= 2;
				else if (node.raw.endsWith('\n')) displayLen -= 1;
				parentActions.splitBlock(index, displayLen);
				return;
			}

			// Remove the empty item, rebuild list, then create a paragraph
			parentActions.beginContainerEdit?.(index, 0);
			performDelete({ children: node.children }, itemBlockIds, itemIndex);
			rebuildListRaw(node);
			parentActions.endContainerEdit?.();
			triggerItemReactivity();

			if (itemIndex === 0) {
				// Empty item was at the start — create paragraph before the list
				await parentActions.splitBlock(index, 0);
				// splitBlock focused the list (index+1), redirect to the paragraph (index)
				parentActions.moveFocus(index, 'start');
			} else {
				// Empty item was in the middle or end — create paragraph after the list
				let displayLen = node.raw.length;
				if (node.raw.endsWith('\r\n')) displayLen -= 2;
				else if (node.raw.endsWith('\n')) displayLen -= 1;
				parentActions.splitBlock(index, displayLen);
			}
		}
	};

	setContext(LIST_CONTEXT_KEY, listContext);
</script>

<div class="list-block">
	{#each node.children ?? [] as item, i (itemBlockIds[i])}
		<ListItemBlock node={item} index={i} bind:this={itemBlockRefs[i]} />
	{/each}
</div>

<style>
	.list-block {
		margin: 4px 0;
		padding-left: 0;
		list-style: none;
	}
</style>
