<script lang="ts">
	import { getContext, setContext } from 'svelte';
	import type {
		BlockEditActions,
		ContainerEditActions,
		FocusActions,
		ListContext
	} from '../../action-contracts';
	import type { BlockComponent } from '../../block-component';
	import type { CstNode } from '../../core/nodes';
	import {
		BLOCK_EDIT_KEY,
		CONTAINER_EDIT_KEY,
		CONTROLLER_KEY,
		FOCUS_KEY,
		LIST_CONTEXT_KEY,
		STICKY_COLUMN_KEY
	} from '../../editor-keys';
	import type { UndoController } from '../../editor-actions/deps';
	import type { StickyColumnState } from '../../cursor/sticky-column';
	import { createListContext } from '../../editor-actions/list-context';
	import { createListOverrides } from '../../editor-actions/list-overrides';
	import { createBlockListState } from '../../reactivity/block-list-state.svelte';
	import {
		createStandardNestedActions,
		setNestedActionsContexts
	} from '../../editor-actions/nested-actions';
	import { createContainerBlockComponent } from '../../editor-actions/container-block-component';
	import ListItemBlock from './ListItemBlock.svelte';

	let { node, index, myPath = [] }: { node: CstNode; index: number; myPath?: number[] } = $props();

	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const parentFocus = getContext<FocusActions>(FOCUS_KEY);
	const parentContainerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const controller = getContext<UndoController>(CONTROLLER_KEY);
	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);

	const state = createBlockListState(() => node);

	// Read parent context before the setContext below shadows it.
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
			get path() {
				return myPath;
			},
			stickyColumn,
			parentListContext,
			parent: {
				blockEdit: parentBlockEdit,
				focus: parentFocus,
				containerEdit: parentContainerEdit
			}
		},
		createListOverrides({
			get index() {
				return index;
			},
			get node() {
				return node;
			},
			get path() {
				return myPath;
			},
			state,
			parentBlockEdit,
			parentContainerEdit
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
		get path() {
			return myPath;
		},
		state,
		parentBlockEdit,
		parentFocus,
		parentListContext,
		controller
	});

	setContext(LIST_CONTEXT_KEY, listContext);

	// ── BlockComponent interface ────────────────────────────────────────

	const containerApi = createContainerBlockComponent({
		get innerBlockRefs() {
			return state.innerBlockRefs;
		},
		get nodeChildrenLength() {
			return node.children?.length ?? 0;
		}
	});
	export const editable = containerApi.editable;
	export const focusable = containerApi.focusable;
	export const focus = containerApi.focus;
	export const getCursorOffset = containerApi.getCursorOffset;
	export const getCursorPosition = containerApi.getCursorPosition;
	export const focusByPath = containerApi.focusByPath;
	export const focusAtColumn = containerApi.focusAtColumn;
	export const isVerticallyTransparent = containerApi.isVerticallyTransparent!;
	export const selectEdgeWidget = containerApi.selectEdgeWidget!;
	export const getBlockComponentByPath = containerApi.getBlockComponentByPath!;

	function setItemRef(i: number, r: BlockComponent | undefined): void {
		state.innerBlockRefs[i] = r;
	}
	function getItemRef(i: number): BlockComponent | undefined {
		return state.innerBlockRefs[i];
	}
</script>

<div class="list-block">
	{#each node.children ?? [] as item, i (state.innerBlockIds[i])}
		<ListItemBlock
			node={item}
			index={i}
			myPath={[...myPath, i]}
			setRef={setItemRef}
			getRef={getItemRef}
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
