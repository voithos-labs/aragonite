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
	import { assignIds, generateBlockId, displayLength } from '../../mutable-tree';
	import {
		deleteNode as performDelete,
		unwrapFirstItemFromList,
		mergeListItemIntoPrevious
	} from '../../tree-operations';
	import { rebuildListRaw, rebuildListItemRaw } from '../../container-raw';
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
		if (offset === FOCUS_LAST_START) {
			// Focus last descendant at start — cascade sentinel through nested containers
			const last = node.children.length - 1;
			itemBlockRefs[last]?.focus(FOCUS_LAST_START);
		} else if (offset === 0) {
			itemBlockRefs[0]?.focus(0);
		} else {
			const last = node.children.length - 1;
			itemBlockRefs[last]?.focus(CURSOR_END);
		}
	}

	export function getCursorOffset(): number | null {
		for (const ref of itemBlockRefs) {
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
		if (path.length === 0) {
			itemBlockRefs[0]?.focus(offset);
			return;
		}
		const [first, ...rest] = path;
		const child = itemBlockRefs[first];
		if (!child) return;
		if (rest.length === 0) {
			child.focus(offset);
		} else {
			// child is a ListItemBlock — delegate
			(child as unknown as { focusByPath?(p: number[], o: number): void }).focusByPath?.(rest, offset);
		}
	}

	void ({ editable, focusable, focus, getCursorOffset } satisfies BlockComponent);

	// ── Helpers ─────────────────────────────────────────────────────────

	function rebuildAndNotify(): void {
		rebuildListRaw(node);
		parentActions.endContainerEdit?.();
	}

	function triggerItemReactivity(): void {
		node.children = [...(node.children ?? [])];
		itemBlockIds = [...itemBlockIds];
	}

	/** Renumber ordered list items starting from `fromIndex`. */
	function renumberFrom(fromIndex: number): void {
		if (!(node.metadata as { ordered: boolean }).ordered || !node.children) return;
		for (let j = fromIndex; j < node.children.length; j++) {
			const prev = j > 0
				? (node.children[j - 1].metadata as { marker: string }).marker
				: '0. ';
			const prevNum = parseInt(prev, 10) || 0;
			const meta = node.children[j].metadata as { marker: string };
			const suffix = meta.marker.replace(/^\d+/, '');
			meta.marker = String(prevNum + 1) + suffix;
			rebuildListItemRaw(node.children[j]);
		}
	}

	/**
	 * An item is "empty" only when every leaf descendant's raw is blank.
	 * Strictly stronger than "first child is an empty paragraph" — the old
	 * check dropped trailing content like extra paragraphs or nested lists
	 * when the first paragraph happened to be empty.
	 */
	function isItemEmpty(item: CstNode): boolean {
		if (!item.children || item.children.length === 0) return true;
		for (const child of item.children) {
			if (child.children && child.children.length > 0) {
				// Recurse into container children (nested lists, blockquotes).
				if (!isItemEmpty(child)) return false;
			} else if ((child.raw ?? '').trim() !== '') {
				return false;
			}
		}
		return true;
	}

	// ── List-level EditorActions ────────────────────────────────────────
	// Handles operations that cross list item boundaries.

	const listActions: EditorActions = {
		// splitBlock at list level: not applicable (list items handle their own splits)
		async splitBlock(): Promise<void> {},

		async mergeWithPrevious(itemIndex: number): Promise<void> {
			if (!node.children) return;

			if (itemIndex <= 0) {
				// Nested list: promote the first item to parent level (like Shift+Tab)
				if (parentListContext && getParentItemIndex) {
					await parentListContext.promoteNestedItem(getParentItemIndex(), node, 0);
					return;
				}

				// Top-level list: check if first item is empty
				const item = node.children[0];
				const firstChildEmpty = isItemEmpty(item);

				if (firstChildEmpty && node.children.length > 1) {
					// Empty first item with siblings — delete just the item
					parentActions.beginContainerEdit?.(index, 0);
					performDelete({ children: node.children }, itemBlockIds, 0);
					renumberFrom(0);
					rebuildListRaw(node);
					parentActions.endContainerEdit?.();
					triggerItemReactivity();
					await tick();
					itemBlockRefs[0]?.focus(0);
				} else if (firstChildEmpty && node.children.length === 1) {
					// Empty only item — delete the entire list, focus block before it
					await parentActions.deleteBlock(index);
					parentActions.moveFocus(index - 1, 'end');
				} else {
					// Non-empty first item — Rule U1: unwrap the item out of the list
					const replacement = unwrapFirstItemFromList(node);
					if (replacement.length === 0) return;
					await parentActions.replaceBlock!(
						index,
						replacement,
						{ replacementIndex: 0, offset: 0 }
					);
				}
				return;
			}

			// Check if current item is empty — if so, delete it
			const item = node.children[itemIndex];
			const isEmptyItem = isItemEmpty(item);
			if (isEmptyItem) {
				parentActions.beginContainerEdit?.(index, 0);
				performDelete({ children: node.children }, itemBlockIds, itemIndex);
				renumberFrom(itemIndex);
				rebuildListRaw(node);
				parentActions.endContainerEdit?.();
				triggerItemReactivity();
				await tick();
				itemBlockRefs[itemIndex - 1]?.focus(CURSOR_END);
				return;
			}

			// Non-empty item — Rule M1: merge into deepest visible text above (rule B)
			// with preserve-absolute-indent child placement.
			parentActions.beginContainerEdit?.(index, 0);
			// mergeListItemIntoPrevious mutates `node` in place and internally rebuilds
			// raw for all affected containers (including `node` itself). No outer rebuildListRaw needed.
			const { mergePoint } = mergeListItemIntoPrevious(node, itemIndex);
			parentActions.endContainerEdit?.();
			triggerItemReactivity();
			await tick();
			// Cascade focus down the target path via focusByPath.
			// targetPath is a path of list-item indices (e.g. [0] for top-level item 0,
			// [0, 1] for item 0 → nested item 1). The offset is within the first child
			// (paragraph) of the target list item, so we always forward via focusByPath
			// with [0] appended to address that first child.
			const [firstPathIdx, ...restPath] = mergePoint.targetPath;
			const topItemRef = itemBlockRefs[firstPathIdx];
			if (topItemRef) {
				(topItemRef as unknown as { focusByPath?(p: number[], o: number): void })
					.focusByPath?.([...restPath, 0], mergePoint.offset);
			}
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
			itemBlockRefs[focusIdx]?.focus(0);
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
				if (typeof position === 'number') item.focus(position);
				else if (position === 'start') item.focus(0);
				else item.focus(CURSOR_END);
			}
		},

		// mergeWithNext at list level: not applicable (list items handle their own merges)
		async mergeWithNext(): Promise<void> {},

		updateBlockContent(): void {
			// List items handle their own content updates
		},

		// insertParsedBlocks at list level: not applicable (paste is handled by inner blocks)
		async insertParsedBlocks(): Promise<void> {},

		async replaceBlock(
			itemIndex: number,
			replacement: CstNode[],
			focus?: { replacementIndex: number; offset: number }
		): Promise<void> {
			// Note: ListBlock.listActions.replaceBlock is called when a caller wants
			// to splice list items. In practice, this happens rarely — U1 and U2
			// typically call replaceBlock on a parent that contains the list, not
			// on the list itself. But a future feature could replace list items.
			if (!node.children || itemIndex < 0 || itemIndex >= node.children.length) return;

			parentActions.beginContainerEdit?.(index, 0);

			// Work on plain copies to prevent $state proxy splice cascades.
			const childrenCopy = [...node.children];
			const idsCopy = [...itemBlockIds];
			const refsCopy = [...itemBlockRefs];

			if (replacement.length === 0) {
				childrenCopy.splice(itemIndex, 1);
				idsCopy.splice(itemIndex, 1);
				refsCopy.splice(itemIndex, 1);
			} else {
				const originalTrivia = node.children[itemIndex].leadingTrivia ?? '';
				const normalizedReplacement = replacement.map((n, i) => {
					const copy = { ...n };
					copy.leadingTrivia = i === 0 ? originalTrivia : (copy.leadingTrivia ?? '');
					return copy;
				});
				childrenCopy.splice(itemIndex, 1, ...normalizedReplacement);
				const newIds = normalizedReplacement.map(() => generateBlockId());
				idsCopy.splice(itemIndex, 1, ...newIds);
				const newRefSlots: (BlockComponent | undefined)[] = new Array(normalizedReplacement.length).fill(undefined);
				refsCopy.splice(itemIndex, 1, ...newRefSlots);
			}

			node.children = childrenCopy;
			itemBlockIds = idsCopy;
			itemBlockRefs = refsCopy;

			rebuildListRaw(node);
			parentActions.endContainerEdit?.();
			triggerItemReactivity();

			await tick();

			if (focus && replacement.length > 0) {
				const targetIdx = itemIndex + focus.replacementIndex;
				itemBlockRefs[targetIdx]?.focus(focus.offset);
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

			// Reset ordered marker to 1 before nesting (new numbering context)
			const ordered = (node.metadata as { ordered: boolean }).ordered;
			if (ordered) {
				const meta = item.metadata as { marker: string };
				const suffix = meta.marker.replace(/^\d+/, '');
				meta.marker = '1' + suffix;
				rebuildListItemRaw(item);
			}

			// Check if prevItem already has a nested list of the same type
			const existingNestedList = prevItem.children.find(
				(c) =>
					c.kind === 'list' &&
					(c.metadata as { ordered: boolean }).ordered === ordered
			);

			if (existingNestedList && existingNestedList.children) {
				existingNestedList.children.push(item);
				rebuildListRaw(existingNestedList);
			} else {
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
			// Renumber remaining items in the parent list after removal
			renumberFrom(itemIndex);
			rebuildListRaw(node);
			parentActions.endContainerEdit?.();
			triggerItemReactivity();
			await tick();

			// Focus the indented item — it's now the last child of the previous
			// item's nested list. FOCUS_LAST_START cascades through containers
			// choosing the last child at each level, placing cursor at offset 0.
			itemBlockRefs[itemIndex - 1]?.focus(FOCUS_LAST_START);
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
			renumberFrom(itemIndex + 1);
			rebuildListRaw(node);
			triggerItemReactivity();
			await tick();
			itemBlockRefs[itemIndex + 1]?.focus(0);
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
			itemBlockRefs[parentItemIdx + 1]?.focus(0);
		},

		async exitListAtItem(itemIndex: number): Promise<void> {
			if (!node.children) return;

			if (node.children.length <= 1) {
				// Only item — replace the list with an empty paragraph via split.
				// Splitting at the end of raw creates a new empty block after.
				parentActions.splitBlock(index, displayLength(node.raw));
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
			} else if (itemIndex >= node.children.length) {
				// Empty item was at the end — create paragraph after the list
				parentActions.splitBlock(index, displayLength(node.raw));
			} else {
				// Empty item was in the middle — split the list at the deletion point.
				// Compute offset: sum of raw for items before the gap.
				let splitOffset = (node.innerPrefix ?? '').length;
				for (let j = 0; j < itemIndex; j++) {
					splitOffset += (node.children[j].leadingTrivia ?? '').length + node.children[j].raw.length;
				}
				await parentActions.splitBlock(index, splitOffset);
				// After split: [first-list at index, second-list at index+1].
				// Split second list at offset 0 to insert a paragraph between them.
				await parentActions.splitBlock(index + 1, 0);
				parentActions.moveFocus(index + 1, 'start');
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
