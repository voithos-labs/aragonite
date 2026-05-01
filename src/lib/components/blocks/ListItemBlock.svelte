<script lang="ts">
	import { getContext, setContext } from 'svelte';
	import {
		BLOCK_EDIT_KEY,
		FOCUS_KEY,
		CONTAINER_EDIT_KEY,
		STICKY_COLUMN_KEY,
		LIST_CONTEXT_KEY,
		SELECTION_KEY,
		type BlockEditActions,
		type FocusActions,
		type ContainerEditActions,
		type ListContext,
		type CstNode,
		type BlockComponent
	} from '../../contracts';
	import type { ListItemMetadata } from '../../core/nodes';
	import type { SelectionState } from '../../selection/selection-state.svelte';
	import type { StickyColumnState } from '../../cursor/sticky-column';
	import { displayLength } from '../../core/lines';
	import { rebuildListItemRaw } from '../../schema/container-raw';
	import { createBlockListState } from '../../reactivity/block-list-state.svelte';
	import {
		createStandardNestedActions,
		setNestedActionsContexts
	} from '../../editor-actions/nested-actions';
	import { createContainerBlockComponent } from '../../editor-actions/container-block-component';
	import { buildTaskItemAmbient } from './list/task-checkbox';
	import BlockList from '../BlockList.svelte';
	import { publishRefSlot } from '../../reactivity/publish-ref.svelte';

	let {
		node,
		index,
		myPath = [],
		setRef,
		getRef
	}: {
		node: CstNode;
		index: number;
		myPath?: number[];
		setRef?: (i: number, r: BlockComponent | undefined) => void;
		getRef?: (i: number) => BlockComponent | undefined;
	} = $props();

	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const parentFocus = getContext<FocusActions>(FOCUS_KEY);
	const parentContainerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);
	const selection = getContext<SelectionState>(SELECTION_KEY);

	const listContext = getContext<ListContext>(LIST_CONTEXT_KEY);

	// Wrap getContainingItemIndex so a nested ListBlock inside this item sees
	// this item's index in the outer list — the coordinate promoteNestedItem needs.
	const wrappedListContext: ListContext = {
		...listContext,
		getContainingItemIndex: () => index
	};
	setContext(LIST_CONTEXT_KEY, wrappedListContext);

	const state = createBlockListState(() => node);

	function toggleTask(): void {
		const meta = node.metadata as ListItemMetadata | undefined;
		if (!meta?.taskItem) return;

		if (selection?.isCrossBlock) {
			selection.clear();
		}

		const nextChecked = !meta.taskChecked;
		const nextMarker = nextChecked ? '[x] ' : '[ ] ';
		parentBlockEdit.updateBlockMetadata(index, {
			taskChecked: nextChecked,
			taskMarker: nextMarker
		});
	}

	const taskCheckedAttr = $derived.by(() => {
		const meta = node.metadata as ListItemMetadata | undefined;
		if (!meta?.taskItem) return undefined;
		return meta.taskChecked ? 'true' : 'false';
	});

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

	const containerApi = createContainerBlockComponent({
		get innerBlockRefs() {
			return state.innerBlockRefs;
		},
		get nodeChildrenLength() {
			return node.children?.length ?? 0;
		}
	});
	export const focus = containerApi.focus;
	export const getCursorOffset = containerApi.getCursorOffset;
	export const getCursorPosition = containerApi.getCursorPosition;
	export const focusByPath = containerApi.focusByPath;
	export const focusAtColumn = containerApi.focusAtColumn;
	export const isVerticallyTransparent = containerApi.isVerticallyTransparent!;
	export const selectEdgeWidget = containerApi.selectEdgeWidget!;

	void ({
		editable,
		focusable,
		focus,
		getCursorOffset,
		getCursorPosition,
		focusByPath,
		focusAtColumn,
		isVerticallyTransparent,
		selectEdgeWidget
	} satisfies BlockComponent);

	$effect(() => {
		if (!setRef || !getRef) return;
		const self: BlockComponent = {
			editable,
			focusable,
			focus,
			getCursorOffset,
			getCursorPosition,
			focusByPath,
			focusAtColumn,
			isVerticallyTransparent,
			selectEdgeWidget
		};
		return publishRefSlot(index, self, setRef, getRef);
	});

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

<div class="list-item-block" data-task-checked={taskCheckedAttr}>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="list-item-content" onkeydown={handleKeydown}>
		<BlockList
			children={node.children ?? []}
			blockIds={state.innerBlockIds}
			setRef={(i, r) => (state.innerBlockRefs[i] = r)}
			getRef={(i) => state.innerBlockRefs[i]}
			parentPath={myPath}
			ambientPrefixForFirst={buildTaskItemAmbient(
				node.metadata as ListItemMetadata | undefined,
				toggleTask
			)}
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

	:global(.task-checkbox) {
		cursor: pointer;
		border-radius: 2px;
		transition: background-color 60ms ease-out;
	}

	:global(.task-checkbox:hover) {
		background-color: var(--md-marker-hover-bg, rgba(128, 128, 128, 0.15));
	}

	/* :first-child scopes strikethrough to this item's own leading block;
	   :not(.list-block) avoids cascading into nested sub-lists, which carry
	   their own data-task-checked state per item. */
	.list-item-block[data-task-checked='true']
		> .list-item-content
		> :global(.block-list)
		> :global(.block-host:first-child)
		> :global(:not(.list-block)) {
		text-decoration: line-through;
		color: var(--text-muted, rgba(128, 128, 128, 0.7));
	}
</style>
