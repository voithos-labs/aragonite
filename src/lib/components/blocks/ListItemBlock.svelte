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
	} from '../../editor-types';
	import type { StickyColumnState } from '../../contenteditable/sticky-column';
	import { displayLength } from '../../raw-text';
	import { splitNode as performSplit } from '../../tree-operations';
	import { rebuildListItemRaw } from '../../tree-operations/container-raw';
	import { createBlockListState } from '../../container-state/block-list-state.svelte';
	import {
		createStandardNestedActions,
		setNestedActionsContexts
	} from '../../container-state/nested-actions';
	import {
		dispatchFocusByPath,
		dispatchFocusAtColumn
	} from '../../container-state/focus-dispatch';
	import BlockList from '../BlockList.svelte';

	let {
		node,
		index,
		myPath = []
	}: { node: CstNode; index: number; myPath?: number[] } = $props();

	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const parentFocus = getContext<FocusActions>(FOCUS_KEY);
	const parentContainerEdit = getContext<ContainerEditActions | undefined>(CONTAINER_EDIT_KEY);
	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);

	// Read parent's ListContext before wrapping — reads methods like
	// exitListAtItem/insertItemAfter that come from the parent list.
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

	const state = createBlockListState(() => node);

	function marker(): string {
		return (node.metadata as { marker?: string })?.marker ?? '- ';
	}

	/** Split the current item's content at offset, moving trailing children to a new sibling item. */
	async function splitItemAtOffset(innerIndex: number, offset: number): Promise<void> {
		if (!node.children) return;

		let newChildren: CstNode[] = [];
		state.commitChildrenEdit((children, ids, refs) => {
			performSplit({ children }, ids, innerIndex, offset);
			newChildren = children.splice(innerIndex + 1);
			ids.splice(innerIndex + 1);
			refs.splice(innerIndex + 1);
			if (newChildren.length > 0) {
				newChildren[0].leadingTrivia = '';
			}
		});

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
	}

	const bundle = createStandardNestedActions(state, {
		get index() {
			return index;
		},
		get node() {
			return node;
		},
		rebuildRaw: () => rebuildListItemRaw(node),
		stickyColumn,
		parent: {
			blockEdit: parentBlockEdit,
			focus: parentFocus,
			containerEdit: parentContainerEdit
		}
	});

	// Override splitBlock for list-item-specific Enter behavior:
	// 1. Empty item — exit list via listContext.exitListAtItem.
	// 2. At end of last child — insert new empty sibling item.
	// 3. In middle — split content across two items using splitItemAtOffset.
	// (All 3 branches return — factory default is not used.)
	bundle.blockEdit.splitBlock = async (innerIndex: number, offset: number): Promise<void> => {
		if (!node.children) return;

		// Empty item — exit list. An item is "user-empty" (for Enter's
		// purposes) if its first child is an empty paragraph, even when
		// trailing structural children exist. Per the requirements spec,
		// those trailing children should be relocated to adjacent items
		// by exitListAtItem — a fix tracked in docs/issues.md. The
		// shallower check here is the correct Enter-path intent; the
		// deeper recursive walker (isItemUserEmpty) is Backspace semantics.
		const firstChild = node.children[0];
		const isEmptyItem = firstChild?.kind === 'paragraph' && firstChild.raw.trim() === '';
		if (isEmptyItem) {
			await listContext.exitListAtItem(index);
			return;
		}

		// At end of last child — insert new empty sibling item.
		const lastChild = node.children[node.children.length - 1];
		const isAtEnd =
			innerIndex === node.children.length - 1 && offset >= displayLength(lastChild.raw);

		if (isAtEnd) {
			parentContainerEdit?.beginContainerEdit(index, offset);
			await listContext.insertItemAfter(index);
			parentContainerEdit?.endContainerEdit();
			return;
		}

		// In middle — split content across two items.
		parentContainerEdit?.beginContainerEdit(index, offset);
		await splitItemAtOffset(innerIndex, offset);
		parentContainerEdit?.endContainerEdit();
	};

	// mergeWithPrevious at innerIndex <= 0 delegates to
	// parentBlockEdit.mergeWithPrevious(index) — that is already the factory
	// default, so no override is needed here.

	setNestedActionsContexts(bundle);

	// ── BlockComponent interface ────────────────────────────────────────

	export const editable = true;
	export const focusable = true;

	export function focus(offset: number): void {
		if (!node.children || node.children.length === 0) return;
		if (offset === FOCUS_LAST_START) {
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
	 * Cascade focus down a path of child indices inside this list item.
	 * Used by ListBlock.focusByPath when the next path element addresses
	 * a nested list inside this item.
	 */
	export function focusByPath(path: number[], offset: number): void {
		dispatchFocusByPath(state.innerBlockRefs, path, offset);
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
			blockIds={state.innerBlockIds}
			bind:blockRefs={state.innerBlockRefs}
			parentPath={myPath}
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
