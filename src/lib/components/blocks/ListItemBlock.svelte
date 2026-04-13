<script lang="ts">
	import { getContext, setContext, tick } from 'svelte';
	import {
		EDITOR_ACTIONS_KEY,
		LIST_CONTEXT_KEY,
		LIST_PARENT_ITEM_INDEX_KEY,
		CURSOR_END,
		FOCUS_LAST_START,
		type EditorActions,
		type ListContext,
		type CstNode,
		type BlockComponent
	} from '../../editor-types';
	import { assignIds, displayLength, generateBlockId } from '../../mutable-tree';
	import {
		splitNode as performSplit,
		mergeWithPrevious as performMerge,
		mergeWithNext as performMergeNext,
		deleteNode as performDelete,
		updateNodeContent as performUpdate
	} from '../../tree-operations';
	import { isMergeEligible, isBlockEditable } from '../../merge-rules';
	import { rebuildListItemRaw } from '../../container-raw';
	import BlockList from '../BlockList.svelte';

	let { node, index }: { node: CstNode; index: number } = $props();

	const parentActions = getContext<EditorActions>(EDITOR_ACTIONS_KEY);
	const listContext = getContext<ListContext>(LIST_CONTEXT_KEY);
	let innerBlockIds = $state<string[]>(assignIds(node.children ?? []));
	let innerBlockRefs = $state<(BlockComponent | undefined)[]>([]);

	// Re-sync inner block IDs when children count changes externally (undo/redo)
	$effect(() => {
		const childCount = (node.children ?? []).length;
		if (childCount !== innerBlockIds.length) {
			innerBlockIds = assignIds(node.children ?? []);
		}
	});

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	export function focus(offset: number): void {
		if (!node.children || node.children.length === 0) return;
		if (offset === FOCUS_LAST_START) {
			const last = node.children.length - 1;
			innerBlockRefs[last]?.focus(FOCUS_LAST_START);
		} else if (offset === 0) {
			innerBlockRefs[0]?.focus(0);
		} else {
			const last = node.children.length - 1;
			innerBlockRefs[last]?.focus(CURSOR_END);
		}
	}

	export function getCursorOffset(): number | null {
		for (const ref of innerBlockRefs) {
			const offset = ref?.getCursorOffset();
			if (offset !== null && offset !== undefined) return offset;
		}
		return null;
	}
	void ({ editable, focusable, focus, getCursorOffset } satisfies BlockComponent);

	// ── Helpers ─────────────────────────────────────────────────────────

	function innerParent(): { children: CstNode[] } {
		return { children: node.children! };
	}

	function rebuildAndNotify(): void {
		rebuildListItemRaw(node);
		parentActions.endContainerEdit?.();
	}

	function triggerInnerReactivity(): void {
		node.children = [...(node.children ?? [])];
		innerBlockIds = [...innerBlockIds];
	}

	function marker(): string {
		return (node.metadata as { marker?: string })?.marker ?? '- ';
	}

	// ── Nested EditorActions ────────────────────────────────────────────
	// (Same pattern as BlockquoteBlock — split, merge, delete, moveFocus,
	// updateBlockContent, undo/redo delegation, container propagation.
	// Uses rebuildListItemRaw instead of rebuildBlockquoteRaw.)

	/** Split the current item's content at offset, moving trailing children to a new sibling item. */
	function splitItemAtOffset(innerIndex: number, offset: number): void {
		if (!node.children) return;

		performSplit(innerParent(), innerBlockIds, innerIndex, offset);

		const newChildren = node.children.splice(innerIndex + 1);
		innerBlockIds.splice(innerIndex + 1);

		if (newChildren.length > 0) {
			newChildren[0].leadingTrivia = '';
		}

		rebuildListItemRaw(node);

		const newItem: CstNode = {
			kind: 'listItem',
			leadingTrivia: '',
			raw: '',
			metadata: { marker: marker(), taskItem: false, taskChecked: false },
			innerPrefix: '',
			children: newChildren,
			innerSuffix: ''
		};
		rebuildListItemRaw(newItem);

		listContext.insertItemAfter(index, newItem);
		triggerInnerReactivity();
	}

	const nestedActions: EditorActions = {
		async splitBlock(innerIndex: number, offset: number): Promise<void> {
			if (!node.children) return;

			// Empty item — exit list. An item is "user-empty" if its first
			// child is an empty paragraph, even if it has trailing structural
			// children (nested lists moved from a previous split).
			const firstChild = node.children[0];
			const isEmptyItem =
				firstChild?.kind === 'paragraph' && firstChild.raw.trim() === '';
			if (isEmptyItem) {
				listContext.exitListAtItem(index);
				return;
			}

			// At end of last child — insert new empty sibling item
			const lastChild = node.children[node.children.length - 1];
			const isAtEnd = innerIndex === node.children.length - 1 && offset >= displayLength(lastChild.raw);

			if (isAtEnd) {
				parentActions.beginContainerEdit?.(index, offset);
				listContext.insertItemAfter(index);
				parentActions.endContainerEdit?.();
				return;
			}

			// In middle — split content across two items
			parentActions.beginContainerEdit?.(index, offset);
			splitItemAtOffset(innerIndex, offset);
			parentActions.endContainerEdit?.();
		},

		async mergeWithPrevious(innerIndex: number): Promise<void> {
			if (!node.children) return;

			if (innerIndex <= 0) {
				// At start of first child in this list item
				// Signal to list-level parent to handle (merge with previous item or exit list)
				parentActions.mergeWithPrevious(index);
				return;
			}

			const prevKind = node.children[innerIndex - 1].kind;
			const currKind = node.children[innerIndex].kind;

			if (isMergeEligible(prevKind, currKind)) {
				const mergeOffset = displayLength(node.children[innerIndex - 1].raw);

				parentActions.beginContainerEdit?.(index, 0);
				performMerge(innerParent(), innerBlockIds, innerIndex);
				rebuildAndNotify();
				triggerInnerReactivity();
				await tick();
				innerBlockRefs[innerIndex - 1]?.focus(mergeOffset);
			} else if (!isBlockEditable(prevKind)) {
				parentActions.beginContainerEdit?.(index, 0);
				performDelete(innerParent(), innerBlockIds, innerIndex - 1);
				rebuildAndNotify();
				triggerInnerReactivity();
				await tick();
				innerBlockRefs[innerIndex - 1]?.focus(0);
			} else {
				innerBlockRefs[innerIndex - 1]?.focus(CURSOR_END);
			}
		},

		async mergeWithNext(innerIndex: number): Promise<void> {
			if (!node.children) return;

			if (innerIndex >= node.children.length - 1) {
				// At last child in this list item — delegate to parent
				parentActions.mergeWithNext(index);
				return;
			}

			const currKind = node.children[innerIndex].kind;
			const nextKind = node.children[innerIndex + 1].kind;

			if (isMergeEligible(currKind, nextKind)) {
				const mergeOffset = displayLength(node.children[innerIndex].raw);

				parentActions.beginContainerEdit?.(index, 0);
				performMergeNext(innerParent(), innerBlockIds, innerIndex);
				rebuildAndNotify();
				triggerInnerReactivity();
				await tick();
				innerBlockRefs[innerIndex]?.focus(mergeOffset);
			} else if (!isBlockEditable(nextKind)) {
				parentActions.beginContainerEdit?.(index, 0);
				performDelete(innerParent(), innerBlockIds, innerIndex + 1);
				rebuildAndNotify();
				triggerInnerReactivity();
				await tick();
				innerBlockRefs[innerIndex]?.focus(CURSOR_END);
			} else {
				innerBlockRefs[innerIndex + 1]?.focus(0);
			}
		},

		async deleteBlock(innerIndex: number): Promise<void> {
			if (!node.children) return;

			if (node.children.length <= 1) {
				parentActions.deleteBlock(index);
				return;
			}

			parentActions.beginContainerEdit?.(index, 0);
			performDelete(innerParent(), innerBlockIds, innerIndex);
			rebuildAndNotify();
			triggerInnerReactivity();
			await tick();
			const focusIdx = Math.min(innerIndex, node.children.length - 1);
			innerBlockRefs[focusIdx]?.focus(0);
		},

		async moveFocus(innerIndex: number, position: 'start' | 'end' | number): Promise<void> {
			if (!node.children) return;

			if (innerIndex < 0) {
				parentActions.moveFocus(index - 1, 'end');
			} else if (innerIndex >= node.children.length) {
				parentActions.moveFocus(index + 1, 'start');
			} else {
				const block = innerBlockRefs[innerIndex];
				if (!block?.focusable) return;
				if (typeof position === 'number') block.focus(position);
				else if (position === 'start') block.focus(0);
				else block.focus(CURSOR_END);
			}
		},

		updateBlockContent(innerIndex: number, text: string, preEditOffset?: number): void {
			if (!node.children) return;
			parentActions.beginContainerEditDebounced?.(index, preEditOffset ?? 0);
			const result = performUpdate(innerParent(), innerIndex, text);
			rebuildListItemRaw(node);
			parentActions.endContainerEdit?.();
			if (result.kindChanged) {
				triggerInnerReactivity();
				tick().then(() => {
					innerBlockRefs[innerIndex]?.focus(text.length > 0 ? text.length - 1 : 0);
				});
			}
		},

		// insertParsedBlocks inside list item: not yet supported (paste is inline only within containers)
		async insertParsedBlocks(): Promise<void> {},

		async replaceBlock(
			innerIndex: number,
			replacement: CstNode[],
			focus?: { replacementIndex: number; offset: number }
		): Promise<void> {
			if (!node.children || innerIndex < 0 || innerIndex >= node.children.length) return;

			parentActions.beginContainerEdit?.(index, 0);

			// Work on plain copies to prevent $state proxy splice cascades.
			const childrenCopy = [...node.children];
			const idsCopy = [...innerBlockIds];
			const refsCopy = [...innerBlockRefs];

			if (replacement.length === 0) {
				childrenCopy.splice(innerIndex, 1);
				idsCopy.splice(innerIndex, 1);
				refsCopy.splice(innerIndex, 1);
			} else {
				const originalTrivia = node.children[innerIndex].leadingTrivia ?? '';
				const normalizedReplacement = replacement.map((n, i) => {
					const copy = { ...n };
					copy.leadingTrivia = i === 0 ? originalTrivia : (copy.leadingTrivia ?? '');
					return copy;
				});
				childrenCopy.splice(innerIndex, 1, ...normalizedReplacement);
				const newIds = normalizedReplacement.map(() => generateBlockId());
				idsCopy.splice(innerIndex, 1, ...newIds);
				const newRefSlots: (BlockComponent | undefined)[] = new Array(normalizedReplacement.length).fill(undefined);
				refsCopy.splice(innerIndex, 1, ...newRefSlots);
			}

			node.children = childrenCopy;
			innerBlockIds = idsCopy;
			innerBlockRefs = refsCopy;

			rebuildListItemRaw(node);
			parentActions.endContainerEdit?.();
			triggerInnerReactivity();

			await tick();

			if (focus && replacement.length > 0) {
				const targetIdx = innerIndex + focus.replacementIndex;
				innerBlockRefs[targetIdx]?.focus(focus.offset);
			}
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
			rebuildListItemRaw(node);
			parentActions.endContainerEdit?.();
		}
	};

	function handleKeydown(e: KeyboardEvent): void {
		if (e.defaultPrevented) return;
		if (e.key === 'Tab' && !e.shiftKey) {
			e.preventDefault();
			listContext.indentItem(index);
		} else if (e.key === 'Tab' && e.shiftKey) {
			e.preventDefault();
			listContext.unindentItem(index);
		}
	}

	setContext(EDITOR_ACTIONS_KEY, nestedActions);
	// Expose this item's index so nested ListBlocks can find their parent item
	// position in the outer list (needed for unindent). Wrapped in a getter
	// because the index prop is reactive and may change after initialization.
	setContext(LIST_PARENT_ITEM_INDEX_KEY, () => index);
</script>

<div class="list-item-block">
	<span class="list-item-marker">{marker()}</span>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="list-item-content" onkeydown={handleKeydown}>
		<BlockList
			children={node.children ?? []}
			blockIds={innerBlockIds}
			bind:blockRefs={innerBlockRefs}
		/>
	</div>
</div>

<style>
	.list-item-block {
		display: flex;
		align-items: flex-start;
	}

	.list-item-marker {
		flex-shrink: 0;
		width: 2em;
		color: var(--color-ui-dulled, #888);
		user-select: none;
	}

	.list-item-content {
		flex: 1;
		min-width: 0;
	}

	.list-item-content :global(.list-block) {
		padding-left: 1em;
	}
</style>
