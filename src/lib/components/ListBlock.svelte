<script lang="ts">
	import { getContext, setContext, tick } from 'svelte';
	import {
		EDITOR_ACTIONS_KEY,
		type EditorActions,
		type MutableNode,
		type BlockComponent
	} from '../editor-types';
	import { assignIds } from '../mutable-tree';
	import { deleteNode as performDelete } from '../tree-operations';
	import { rebuildListRaw } from '../container-raw';
	import ListItemBlock from './ListItemBlock.svelte';

	let { node, index }: { node: MutableNode; index: number } = $props();

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
			itemBlockRefs[last]?.focus?.(999999);
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

			// Move focus to end of previous list item
			itemBlockRefs[itemIndex - 1]?.focus?.(999999);
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

		async moveFocus(
			itemIndex: number,
			position: 'start' | 'end' | number
		): Promise<void> {
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
				else item.focus?.(999999);
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

		beginContainerEdit(blockIndex: number, offset: number): void {
			parentActions.beginContainerEdit?.(index, offset);
		},

		beginContainerEditDebounced(blockIndex: number, offset: number): void {
			parentActions.beginContainerEditDebounced?.(index, offset);
		},

		endContainerEdit(): void {
			rebuildListRaw(node);
			parentActions.endContainerEdit?.();
		}
	};

	setContext(EDITOR_ACTIONS_KEY, listActions);
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
