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
	import { displayLength } from '../../core/lines';
	import { rebuildListItemRaw } from '../../tree-operations/container-raw';
	import { createBlockListState } from '../../block-list-state.svelte';
	import {
		createStandardNestedActions,
		setNestedActionsContexts
	} from '../../editor-actions/nested-actions';
	import { dispatchFocusByPath, dispatchFocusAtColumn } from '../../editor-actions/focus-dispatch';
	import BlockList from '../BlockList.svelte';

	let { node, index, myPath = [] }: { node: CstNode; index: number; myPath?: number[] } = $props();

	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const parentFocus = getContext<FocusActions>(FOCUS_KEY);
	const parentContainerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);

	const listContext = getContext<ListContext>(LIST_CONTEXT_KEY);

	// Wrap getContainingItemIndex so a nested ListBlock inside this item sees
	// this item's index in the outer list — the coordinate promoteNestedItem needs.
	const wrappedListContext: ListContext = {
		...listContext,
		getContainingItemIndex: () => index
	};
	setContext(LIST_CONTEXT_KEY, wrappedListContext);

	const state = createBlockListState(() => node);

	function marker(): string {
		return (node.metadata as { marker?: string })?.marker ?? '- ';
	}

	const bundle = createStandardNestedActions(
		state,
		{
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
		},
		() => ({
			blockEdit: {
				splitBlock: async (innerIndex: number, offset: number): Promise<void> => {
					if (!node.children) return;

					// Enter-empty: first child is an empty paragraph. Deliberately shallower than
					// isItemUserEmpty (used by Backspace) — trailing structural children stay
					// until exitListAtItem relocates them (see docs/issues.md).
					const firstChild = node.children[0];
					const isEmptyItem = firstChild?.kind === 'paragraph' && firstChild.raw.trim() === '';
					if (isEmptyItem) {
						await listContext.exitListAtItem(index);
						return;
					}

					const lastChild = node.children[node.children.length - 1];
					const isAtEnd =
						innerIndex === node.children.length - 1 && offset >= displayLength(lastChild.raw);

					if (isAtEnd) {
						await listContext.insertItemAfter(index);
						return;
					}

					await listContext.splitItemAtOffset(index, innerIndex, offset);
				}
				// mergeWithPrevious at innerIndex <= 0 is the factory default — no override needed.
			}
		})
	);

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
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="list-item-content" onkeydown={handleKeydown}>
		<BlockList
			children={node.children ?? []}
			blockIds={state.innerBlockIds}
			bind:blockRefs={state.innerBlockRefs}
			parentPath={myPath}
			ambientPrefixForFirst={marker()}
		/>
	</div>
</div>

<style>
	.list-item-block {
		display: flex;
		align-items: flex-start;
	}

	.list-item-content {
		flex: 1;
		min-width: 0;
	}

	.list-item-content :global(.list-block) {
		padding-left: 1em;
	}
</style>
