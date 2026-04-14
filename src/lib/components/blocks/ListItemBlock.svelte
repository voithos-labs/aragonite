<script lang="ts">
	import { getContext, setContext, tick } from 'svelte';
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
		type FocusPosition,
		type StickyColumnDirection,
		type ListContext,
		type CstNode,
		type BlockComponent
	} from '../../editor-types';
	import type { StickyColumnState } from '../../sticky-column';
	import { assignIds, generateBlockId } from '../../mutable-tree';
	import { displayLength } from '../../raw-text';
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

	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const parentFocus = getContext<FocusActions>(FOCUS_KEY);
	const parentContainerEdit = getContext<ContainerEditActions | undefined>(CONTAINER_EDIT_KEY);
	const listContext = getContext<ListContext>(LIST_CONTEXT_KEY);

	// Wrap parent's ListContext with a getContainingItemIndex that returns
	// this item's index. A nested ListBlock rendered inside this item reads
	// the wrapped version, so its call to getContainingItemIndex() returns
	// *this* item's position in the outer list — what promoteNestedItem
	// needs as the parentItemIndex coordinate.
	const wrappedListContext: ListContext = {
		...listContext,
		getContainingItemIndex: () => index
	};

	setContext(LIST_CONTEXT_KEY, wrappedListContext);

	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);
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

	/**
	 * Cascade focus down a path of child indices inside this list item.
	 * Used by ListBlock.focusByPath when the next path element addresses
	 * a nested list inside this item.
	 */
	export function focusByPath(path: number[], offset: number): void {
		if (path.length === 0 || !node.children) return;
		const [first, ...rest] = path;
		const child = innerBlockRefs[first];
		if (!child) return;
		if (rest.length === 0) {
			child.focus(offset);
		} else {
			child.focusByPath?.(rest, offset);
		}
	}

	/**
	 * Position the cursor at the offset nearest to editor-relative pixel X
	 * inside this list item's first (from='above') or last (from='below')
	 * inner block. Delegates to the child block's focusAtColumn? if available,
	 * else falls back to focus(0) / focus(CURSOR_END). List item itself does
	 * no pixel math — it just picks the right child and forwards.
	 */
	export function focusAtColumn(x: number, from: StickyColumnDirection): void {
		if (!node.children || node.children.length === 0) return;
		if (from === 'above') {
			const first = innerBlockRefs[0];
			if (first?.focusAtColumn) {
				first.focusAtColumn(x, from);
			} else {
				first?.focus(0);
			}
		} else {
			const last = node.children.length - 1;
			const lastRef = innerBlockRefs[last];
			if (lastRef?.focusAtColumn) {
				lastRef.focusAtColumn(x, from);
			} else {
				lastRef?.focus(CURSOR_END);
			}
		}
	}

	void ({ editable, focusable, focus, getCursorOffset, focusByPath, focusAtColumn } satisfies BlockComponent);

	// ── Helpers ─────────────────────────────────────────────────────────

	function asNodeParent(): { children: CstNode[] } {
		return { children: node.children! };
	}

	function finalizeContainerEdit(): void {
		rebuildListItemRaw(node);
		parentContainerEdit?.endContainerEdit();
	}

	function triggerInnerReactivity(): void {
		node.children = [...(node.children ?? [])];
		innerBlockIds = [...innerBlockIds];
	}

	function marker(): string {
		return (node.metadata as { marker?: string })?.marker ?? '- ';
	}

	// ── Nested Actions ──────────────────────────────────────────────────
	// Mirrors BlockquoteBlock's delegation pattern; uses rebuildListItemRaw.

	/** Split the current item's content at offset, moving trailing children to a new sibling item. */
	async function splitItemAtOffset(innerIndex: number, offset: number): Promise<void> {
		if (!node.children) return;

		performSplit(asNodeParent(), innerBlockIds, innerIndex, offset);

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

		await listContext.insertItemAfter(index, newItem);
		triggerInnerReactivity();
	}

	// ── Nested action bundles ────────────────────────────────────────────

	const nestedBlockEdit: BlockEditActions = {
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
				parentContainerEdit?.beginContainerEdit(index, offset);
				listContext.insertItemAfter(index);
				parentContainerEdit?.endContainerEdit();
				return;
			}

			// In middle — split content across two items
			parentContainerEdit?.beginContainerEdit(index, offset);
			await splitItemAtOffset(innerIndex, offset);
			parentContainerEdit?.endContainerEdit();
		},

		async mergeWithPrevious(innerIndex: number): Promise<void> {
			if (!node.children) return;

			if (innerIndex <= 0) {
				// At start of first child in this list item
				// Signal to list-level parent to handle (merge with previous item or exit list)
				parentBlockEdit.mergeWithPrevious(index);
				return;
			}

			const prevKind = node.children[innerIndex - 1].kind;
			const currKind = node.children[innerIndex].kind;

			if (isMergeEligible(prevKind, currKind)) {
				const mergeOffset = displayLength(node.children[innerIndex - 1].raw);

				parentContainerEdit?.beginContainerEdit(index, 0);
				performMerge(asNodeParent(), innerBlockIds, innerIndex);
				innerBlockRefs.splice(innerIndex, 1);
				finalizeContainerEdit();
				triggerInnerReactivity();
				await tick();
				innerBlockRefs[innerIndex - 1]?.focus(mergeOffset);
			} else if (!isBlockEditable(prevKind)) {
				parentContainerEdit?.beginContainerEdit(index, 0);
				performDelete(asNodeParent(), innerBlockIds, innerIndex - 1);
				innerBlockRefs.splice(innerIndex - 1, 1);
				finalizeContainerEdit();
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
				parentBlockEdit.mergeWithNext(index);
				return;
			}

			const currKind = node.children[innerIndex].kind;
			const nextKind = node.children[innerIndex + 1].kind;

			if (isMergeEligible(currKind, nextKind)) {
				const mergeOffset = displayLength(node.children[innerIndex].raw);

				parentContainerEdit?.beginContainerEdit(index, 0);
				performMergeNext(asNodeParent(), innerBlockIds, innerIndex);
				innerBlockRefs.splice(innerIndex + 1, 1);
				finalizeContainerEdit();
				triggerInnerReactivity();
				await tick();
				innerBlockRefs[innerIndex]?.focus(mergeOffset);
			} else if (!isBlockEditable(nextKind)) {
				parentContainerEdit?.beginContainerEdit(index, 0);
				performDelete(asNodeParent(), innerBlockIds, innerIndex + 1);
				innerBlockRefs.splice(innerIndex + 1, 1);
				finalizeContainerEdit();
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
				parentBlockEdit.deleteBlock(index);
				return;
			}

			parentContainerEdit?.beginContainerEdit(index, 0);
			performDelete(asNodeParent(), innerBlockIds, innerIndex);
			innerBlockRefs.splice(innerIndex, 1);
			finalizeContainerEdit();
			triggerInnerReactivity();
			await tick();
			const focusIdx = Math.min(innerIndex, node.children.length - 1);
			innerBlockRefs[focusIdx]?.focus(0);
		},

		updateBlockContent(innerIndex: number, text: string, preEditOffset?: number): void {
			if (!node.children) return;
			parentContainerEdit?.beginContainerEditDebounced(index, preEditOffset ?? 0);
			const result = performUpdate(asNodeParent(), innerIndex, text);
			rebuildListItemRaw(node);
			parentContainerEdit?.endContainerEdit();
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

			parentContainerEdit?.beginContainerEdit(index, 0);

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
				const normalizedReplacement = replacement.map((replacementNode, i) => {
					const copy = { ...replacementNode };
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
			parentContainerEdit?.endContainerEdit();
			triggerInnerReactivity();

			await tick();

			if (focus && replacement.length > 0) {
				const targetIdx = innerIndex + focus.replacementIndex;
				innerBlockRefs[targetIdx]?.focus(focus.offset);
			}
		}
	};

	const nestedFocus: FocusActions = {
		async moveFocus(innerIndex: number, position: FocusPosition): Promise<void> {
			if (!node.children) return;

			if (innerIndex < 0) {
				parentFocus.moveFocus(index - 1, position);
				return;
			}
			if (innerIndex >= node.children.length) {
				parentFocus.moveFocus(index + 1, position);
				return;
			}

			const block = innerBlockRefs[innerIndex];
			if (!block?.focusable) return;

			// Sticky-column variant: use focusAtColumn if available, else fall back
			if (typeof position === 'object' && 'stickyColumnFrom' in position) {
				const x = stickyColumn.get();
				const from = position.stickyColumnFrom;
				if (x !== null && block.focusAtColumn) {
					block.focusAtColumn(x, from);
					return;
				}
				block.focus(from === 'above' ? 0 : CURSOR_END);
				return;
			}

			if (typeof position === 'number') block.focus(position);
			else if (position === 'start') block.focus(0);
			else block.focus(CURSOR_END);
		}
	};

	const nestedContainerEdit: ContainerEditActions = {
		// Propagate container support for deeply nested containers
		beginContainerEdit(_blockIndex: number, offset: number): void {
			parentContainerEdit?.beginContainerEdit(index, offset);
		},

		beginContainerEditDebounced(_blockIndex: number, offset: number): void {
			parentContainerEdit?.beginContainerEditDebounced(index, offset);
		},

		endContainerEdit(): void {
			rebuildListItemRaw(node);
			parentContainerEdit?.endContainerEdit();
		}
	};

	setContext(BLOCK_EDIT_KEY, nestedBlockEdit);
	setContext(FOCUS_KEY, nestedFocus);
	setContext(CONTAINER_EDIT_KEY, nestedContainerEdit);

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
