<script lang="ts">
	import { getContext } from 'svelte';
	import type {
		BlockEditActions,
		ContainerEditActions,
		FocusActions
	} from '../../action-contracts';
	import type { NodeView } from '../../core/node-views';
	import {
		BLOCK_EDIT_KEY,
		CONTAINER_EDIT_KEY,
		EDITOR_SERVICES_KEY,
		FOCUS_KEY,
		type EditorServices
	} from '../../editor-keys';
	import { createBlockquoteOverrides } from '../../editor-actions/blockquote-overrides';
	import { createBlockListState } from '../../reactivity/block-list-state.svelte';
	import { useContainerWindowing } from '../../reactivity/use-container-windowing.svelte';
	import {
		createStandardNestedActions,
		setNestedActionsContexts
	} from '../../editor-actions/nested/nested-actions';
	import { createContainerBlockComponent } from '../../editor-actions/container-block-component';
	import BlockList from '../BlockList.svelte';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const parentFocus = getContext<FocusActions>(FOCUS_KEY);
	const parentContainerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const { controller, stickyColumn } = getContext<EditorServices>(EDITOR_SERVICES_KEY);

	const listState = createBlockListState(() => node);

	let boxEl: HTMLElement | undefined = $state();

	const bundle = createStandardNestedActions(
		listState,
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
			get path() {
				return myPath;
			},
			state: listState,
			parentBlockEdit,
			parentFocus,
			controller
		})
	);

	setNestedActionsContexts(bundle);

	// ── Virtual rendering (nested windowing) ────────────────────────────

	const windowing = useContainerWindowing({
		getIndex: () => index,
		getParentPath: () => myPath,
		getChildren: () => node.children ?? [],
		getChildIds: () => listState.innerBlockIds,
		getListEl: () => boxEl?.querySelector(':scope > .block-list') ?? null,
		getOwnEl: () => boxEl?.closest('.block-host') ?? null,
		provideLeafChannel: true
	});

	// ── BlockComponent interface ────────────────────────────────────────

	const containerApi = createContainerBlockComponent({
		get innerBlockRefs() {
			return listState.innerBlockRefs;
		},
		get nodeChildrenLength() {
			return node.children?.length ?? 0;
		},
		get node() {
			return node;
		},
		revealChild: windowing.revealChild,
		isInWindow: windowing.isInWindow
	});
	export const editable = containerApi.editable;
	export const focusable = containerApi.focusable;
	export const focus = containerApi.focus;
	export const getCursorOffset = containerApi.getCursorOffset;
	export const getCursorPosition = containerApi.getCursorPosition;
	export const focusByPath = containerApi.focusByPath;
	export const focusAtColumn = containerApi.focusAtColumn;
	export const isVerticallyTransparent = containerApi.isVerticallyTransparent!;
	export const enterEdgeWidget = containerApi.enterEdgeWidget!;
	export const getBlockComponentByPath = containerApi.getBlockComponentByPath!;
	export const revealByPath = containerApi.revealByPath!;
</script>

<div class="blockquote-block" bind:this={boxEl}>
	<BlockList
		children={node.children ?? []}
		blockIds={listState.innerBlockIds}
		setRef={(i, r) => (listState.innerBlockRefs[i] = r)}
		getRef={(i) => listState.innerBlockRefs[i]}
		parentPath={myPath}
		window={windowing.window}
		reorderable={true}
	/>
</div>

<style>
	.blockquote-block {
		border-left: 3px solid var(--color-ui-muted, #a4a4a4);
		padding-left: 16px;
		margin: 4px 0;
	}
</style>
