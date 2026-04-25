<script lang="ts">
	import { getContext } from 'svelte';
	import {
		BLOCK_EDIT_KEY,
		FOCUS_KEY,
		CONTAINER_EDIT_KEY,
		CONTROLLER_KEY,
		STICKY_COLUMN_KEY,
		type BlockEditActions,
		type FocusActions,
		type ContainerEditActions,
		type CstNode,
		type BlockComponent
	} from '../../contracts';
	import type { UndoController } from '../../editor-actions/deps';
	import type { StickyColumnState } from '../../cursor/sticky-column';
	import { rebuildBlockquoteRaw } from '../../schema/container-raw';
	import { createBlockquoteOverrides } from '../../editor-actions/blockquote-context';
	import { createBlockListState } from '../../reactivity/block-list-state.svelte';
	import {
		createStandardNestedActions,
		setNestedActionsContexts
	} from '../../editor-actions/nested-actions';
	import { createContainerBlockComponent } from '../../editor-actions/container-block-component';
	import BlockList from '../BlockList.svelte';

	let { node, index, myPath = [] }: { node: CstNode; index: number; myPath?: number[] } = $props();

	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const parentFocus = getContext<FocusActions>(FOCUS_KEY);
	const parentContainerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const controller = getContext<UndoController>(CONTROLLER_KEY);
	const stickyColumn = getContext<StickyColumnState>(STICKY_COLUMN_KEY);

	const state = createBlockListState(() => node);

	const bundle = createStandardNestedActions(
		state,
		{
			get index() {
				return index;
			},
			get node() {
				return node;
			},
			rebuildRaw: () => rebuildBlockquoteRaw(node),
			stickyColumn,
			parent: {
				blockEdit: parentBlockEdit,
				focus: parentFocus,
				containerEdit: parentContainerEdit
			}
		},
		createBlockquoteOverrides({
			get index() {
				return index;
			},
			get node() {
				return node;
			},
			state,
			parentBlockEdit,
			parentFocus,
			controller
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
	export const focusByPath = containerApi.focusByPath;
	export const focusAtColumn = containerApi.focusAtColumn;

	void ({
		editable,
		focusable,
		focus,
		getCursorOffset,
		focusByPath,
		focusAtColumn
	} satisfies BlockComponent);
</script>

<div class="blockquote-block">
	<BlockList
		children={node.children ?? []}
		blockIds={state.innerBlockIds}
		bind:blockRefs={state.innerBlockRefs}
		parentPath={myPath}
	/>
</div>

<style>
	.blockquote-block {
		border-left: 3px solid var(--color-ui-muted, #555);
		padding-left: 16px;
		margin: 4px 0;
	}
</style>
