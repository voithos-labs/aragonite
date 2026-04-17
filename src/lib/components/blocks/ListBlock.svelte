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
	} from '../../contracts';
	import type { StickyColumnState } from '../../contenteditable/sticky-column';
	import { generateBlockId } from '../../tree-operations/block-id';
	import {
		deleteNode as performDelete,
		unwrapFirstItemFromList,
		mergeListItemIntoPrevious,
		renumberOrderedList,
		isItemUserEmpty
	} from '../../tree-operations';
	import { rebuildListRaw } from '../../tree-operations/container-raw';
	import { createListContext } from '../../tree-operations/list-context';
	import { createBlockListState } from './container-state/block-list-state.svelte';
	import {
		createStandardNestedActions,
		setNestedActionsContexts
	} from './container-state/nested-actions';
	import {
		dispatchFocusByPath,
		dispatchFocusAtColumn
	} from './container-state/focus-dispatch';
	import ListItemBlock from './ListItemBlock.svelte';

	let {
		node,
		index,
		myPath = []
	}: { node: CstNode; index: number; myPath?: number[] } = $props();

	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const parentFocus = getContext<FocusActions>(FOCUS_KEY);
	const parentContainerEdit = getContext<ContainerEditActions | undefined>(CONTAINER_EDIT_KEY);
	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);

	const state = createBlockListState(() => node);

	// Shorthand helpers — keep calling code concise.
	function finalizeContainerEdit(): void {
		rebuildListRaw(node);
		parentContainerEdit?.endContainerEdit();
	}

	// The "item is user-empty" helper lives in tree-operations/list-ops.ts
	// and is shared with ListItemBlock.splitBlock so Enter and Backspace
	// use the same recursive emptiness check.

	const bundle = createStandardNestedActions(state, {
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
	});

	// ── ListBlock-specific overrides ────────────────────────────────────────
	// The list doesn't handle splits/merges/updates at the list-wrapper level;
	// those are handled by individual ListItemBlock components. Override the
	// factory defaults with no-ops or list-specific logic.

	// splitBlock at list level: not applicable (list items handle their own splits)
	bundle.blockEdit.splitBlock = async (): Promise<void> => {};

	// mergeWithNext at list level: for an inner item, forward-delete at end
	// of content is a no-op — list items are structural peers and don't
	// concat their raws. For the LAST item, delegate upward so the editor's
	// cross-container merge handler can merge the following block into the
	// list's deepest prose leaf (symmetric with Backspace from the block
	// after the list).
	bundle.blockEdit.mergeWithNext = async (itemIndex: number): Promise<void> => {
		if (!node.children) return;
		if (itemIndex >= node.children.length - 1) {
			await parentBlockEdit.mergeWithNext(index);
		}
	};

	// updateBlockContent at list level: not applicable
	bundle.blockEdit.updateBlockContent = (): void => {};

	// insertParsedBlocks at list level: not applicable
	bundle.blockEdit.insertParsedBlocks = async (): Promise<void> => {};

	// mergeWithPrevious — custom U1/M1 logic (copy verbatim from pre-migration).
	// This is the core list-editing behavior for Backspace at item start.
	bundle.blockEdit.mergeWithPrevious = async (itemIndex: number): Promise<void> => {
		if (!node.children) return;

		if (itemIndex <= 0) {
			// Nested list: promote the first item to parent level (like Shift+Tab)
			if (parentListContext) {
				await parentListContext.promoteNestedItem(parentListContext.getContainingItemIndex(), node, 0);
				return;
			}

			// Top-level list: check if first item is empty
			const item = node.children[0];
			const firstChildEmpty = isItemUserEmpty(item);

			if (firstChildEmpty && node.children.length > 1) {
				// Empty first item with siblings — delete just the item
				parentContainerEdit?.beginContainerEdit(index, 0);
				state.commitChildrenEdit((children, ids, refs) => {
					performDelete({ children }, ids, 0);
					refs.splice(0, 1);
				});
				renumberOrderedList(node, 0);
				rebuildListRaw(node);
				parentContainerEdit?.endContainerEdit();
				state.triggerReactivity();
				await tick();
				state.innerBlockRefs[0]?.focus(0);
			} else if (firstChildEmpty && node.children.length === 1) {
				// Empty only item — delete the entire list, focus block before it
				await parentBlockEdit.deleteBlock(index);
				parentFocus.moveFocus(index - 1, 'end');
			} else {
				// Non-empty first item — Rule U1: unwrap the item out of the list
				const replacement = unwrapFirstItemFromList(node);
				if (replacement.length === 0) return;
				await parentBlockEdit.replaceBlock(
					index,
					replacement,
					{ replacementIndex: 0, offset: 0 }
				);
			}
			return;
		}

		// Check if current item is empty — if so, delete it
		const item = node.children[itemIndex];
		const isEmptyItem = isItemUserEmpty(item);
		if (isEmptyItem) {
			parentContainerEdit?.beginContainerEdit(index, 0);
			state.commitChildrenEdit((children, ids, refs) => {
				performDelete({ children }, ids, itemIndex);
				refs.splice(itemIndex, 1);
			});
			renumberOrderedList(node, itemIndex);
			rebuildListRaw(node);
			parentContainerEdit?.endContainerEdit();
			state.triggerReactivity();
			await tick();
			state.innerBlockRefs[itemIndex - 1]?.focus(CURSOR_END);
			return;
		}

		// Non-empty item — Rule M1: merge into deepest visible text above (rule B)
		// with preserve-absolute-indent child placement.
		parentContainerEdit?.beginContainerEdit(index, 0);
		// mergeListItemIntoPrevious mutates `node` in place and internally rebuilds
		// raw for all affected containers (including `node` itself). No outer rebuildListRaw needed.
		const { mergePoint } = mergeListItemIntoPrevious(node, itemIndex);
		parentContainerEdit?.endContainerEdit();
		state.triggerReactivity();
		await tick();
		// Cascade focus down the target path via focusByPath.
		// targetPath is a uniform path (every child-array index explicit) from
		// this list down to the target listItem — the paragraph index was stripped
		// before returning, so we append 0 here to forward into the item's first
		// child (the target paragraph).
		const [firstPathIdx, ...restPath] = mergePoint.targetPath;
		state.innerBlockRefs[firstPathIdx]?.focusByPath?.([...restPath, 0], mergePoint.offset);
	};

	// deleteBlock — custom delete-whole-list-if-last-item logic.
	bundle.blockEdit.deleteBlock = async (itemIndex: number): Promise<void> => {
		if (!node.children) return;

		if (node.children.length <= 1) {
			// Last item — delete entire list
			parentBlockEdit.deleteBlock(index);
			return;
		}

		parentContainerEdit?.beginContainerEdit(index, 0);
		state.commitChildrenEdit((children, ids, refs) => {
			performDelete({ children }, ids, itemIndex);
			refs.splice(itemIndex, 1);
		});
		finalizeContainerEdit();
		state.triggerReactivity();
		await tick();
		const focusIdx = Math.min(itemIndex, node.children.length - 1);
		state.innerBlockRefs[focusIdx]?.focus(0);
	};

	// replaceBlock — custom item-splice flow for list items.
	bundle.blockEdit.replaceBlock = async (
		itemIndex: number,
		replacement: CstNode[],
		focus?: { replacementIndex: number; offset: number }
	): Promise<void> => {
		// Note: ListBlock.replaceBlock is called when a caller wants to splice
		// list items. In practice, this happens rarely — U1 and U2 typically
		// call replaceBlock on a parent that contains the list, not on the list
		// itself. But a future feature could replace list items.
		if (!node.children || itemIndex < 0 || itemIndex >= node.children.length) return;

		parentContainerEdit?.beginContainerEdit(index, 0);

		state.commitChildrenEdit((children, ids, refs) => {
			if (replacement.length === 0) {
				children.splice(itemIndex, 1);
				ids.splice(itemIndex, 1);
				refs.splice(itemIndex, 1);
			} else {
				const originalTrivia = children[itemIndex].leadingTrivia ?? '';
				const normalizedReplacement = replacement.map((replacementNode, i) => {
					const copy = { ...replacementNode };
					copy.leadingTrivia = i === 0 ? originalTrivia : (copy.leadingTrivia ?? '');
					return copy;
				});
				children.splice(itemIndex, 1, ...normalizedReplacement);
				ids.splice(itemIndex, 1, ...normalizedReplacement.map(() => generateBlockId()));
				refs.splice(itemIndex, 1, ...new Array(normalizedReplacement.length).fill(undefined));
			}
		});

		rebuildListRaw(node);
		parentContainerEdit?.endContainerEdit();
		state.triggerReactivity();

		await tick();

		if (focus && replacement.length > 0) {
			const targetIdx = itemIndex + focus.replacementIndex;
			state.innerBlockRefs[targetIdx]?.focus(focus.offset);
		}
	};

	// Override moveFocus to use node.children.length for bounds checking instead
	// of refs.length. After M1 merges reduce the item count, refs.length can be
	// stale for one render cycle (bind:this sets slots to undefined asynchronously),
	// causing dispatchMoveFocus to silently return instead of delegating upward.
	// The original ListBlock used node.children.length directly — preserve that.
	bundle.focus.moveFocus = async (itemIndex: number, position: FocusPosition): Promise<void> => {
		if (!node.children) return;

		if (itemIndex < 0) {
			// Before first item — move before the list
			parentFocus.moveFocus(index - 1, position);
			return;
		}
		if (itemIndex >= node.children.length) {
			// After last item — move after the list
			parentFocus.moveFocus(index + 1, position);
			return;
		}

		const item = state.innerBlockRefs[itemIndex];
		if (!item?.focusable) return;

		// Sticky-column variant: use focusAtColumn if available, else fall back
		if (typeof position === 'object' && 'stickyColumnFrom' in position) {
			const x = stickyColumn.get();
			const from = position.stickyColumnFrom;
			if (x !== null && item.focusAtColumn) {
				item.focusAtColumn(x, from);
				return;
			}
			item.focus(from === 'above' ? 0 : CURSOR_END);
			return;
		}

		if (typeof position === 'number') item.focus(position);
		else if (position === 'start') item.focus(0);
		else item.focus(CURSOR_END);
	};

	setNestedActionsContexts(bundle);

	// ── List Context ────────────────────────────────────────────────────
	// Provides list-specific operations to child ListItemBlock components.
	// Read parent list context BEFORE setContext shadows it. For nested lists
	// this returns the outer list's context; for top-level lists it is undefined.
	const parentListContext = getContext<ListContext | undefined>(LIST_CONTEXT_KEY);

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

	void ({ editable, focusable, focus, getCursorOffset, focusByPath, focusAtColumn } satisfies BlockComponent);
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
