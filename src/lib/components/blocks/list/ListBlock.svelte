<script lang="ts">
	import { getContext, setContext } from 'svelte';
	import type {
		BlockEditActions,
		ContainerEditActions,
		FocusActions,
		ListContext
	} from '../../../action-contracts';
	import type { NodeView } from '../../../core/node-views';
	import {
		BLOCK_EDIT_KEY,
		CONTAINER_EDIT_KEY,
		EDITOR_DOC_KEY,
		EDITOR_SERVICES_KEY,
		FOCUS_KEY,
		LIST_CONTEXT_KEY,
		type EditorDoc,
		type EditorServices
	} from '../../../editor-keys';
	import { createListContext } from '../../../editor-actions/list-context';
	import { createListOverrides } from '../../../editor-actions/list-overrides';
	import { createBlockListState } from '../../../reactivity/block-list-state.svelte';
	import { useContainerWindowing } from '../../../reactivity/use-container-windowing.svelte';
	import { sliceWindow } from '../../../reactivity/window-slice';
	import {
		createStandardNestedActions,
		setNestedActionsContexts,
		type NodeScope
	} from '../../../editor-actions/nested/nested-actions';
	import { createContainerBlockComponent } from '../../../editor-actions/container-block-component';
	import ListItemBlock from './ListItemBlock.svelte';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	const parentBlockEdit = getContext<BlockEditActions>(BLOCK_EDIT_KEY);
	const parentFocus = getContext<FocusActions>(FOCUS_KEY);
	const parentContainerEdit = getContext<ContainerEditActions>(CONTAINER_EDIT_KEY);
	const { controller, stickyColumn, selection } = getContext<EditorServices>(EDITOR_SERVICES_KEY);
	const { reading } = getContext<EditorDoc>(EDITOR_DOC_KEY);

	const listState = createBlockListState(() => node);

	let boxEl: HTMLElement | undefined = $state();

	// Read parent context before the setContext below shadows it.
	const parentListContext = getContext<ListContext | undefined>(LIST_CONTEXT_KEY);

	// Created once and passed by reference to every factory below, never spread.
	const scope: NodeScope = {
		get index() {
			return index;
		},
		get node() {
			return node;
		},
		get path() {
			return myPath;
		}
	};

	const bundle = createStandardNestedActions(
		listState,
		{
			scope,
			stickyColumn,
			reading,
			parentListContext,
			parent: {
				blockEdit: parentBlockEdit,
				focus: parentFocus,
				containerEdit: parentContainerEdit
			}
		},
		createListOverrides({ scope, parentBlockEdit })
	);

	setNestedActionsContexts(bundle);

	const listContext = createListContext({
		scope,
		state: listState,
		parentBlockEdit,
		parentFocus,
		parentListContext,
		controller,
		reading
	});

	setContext(LIST_CONTEXT_KEY, listContext);

	// ── Virtual rendering (item windowing) ──────────────────────────────

	const windowing = useContainerWindowing({
		getIndex: () => index,
		getParentPath: () => myPath,
		getChildren: () => node.children ?? [],
		getChildIds: () => listState.innerBlockIds,
		// The .list-block is the content origin: it holds the spacers and the items.
		getListEl: () => boxEl ?? null,
		// A list is itself a BlockHost block, so it reports its height the same way the
		// parent measured it and the subtotal sent up does not fight that measurement.
		getOwnEl: () => boxEl?.closest('.block-host') ?? null,
		provideLeafChannel: false
	});

	let win = $derived(windowing.window);
	let bounds = $derived(sliceWindow((node.children ?? []).length, win));

	// ── BlockComponent interface ────────────────────────────────────────

	export const containerApi = createContainerBlockComponent({
		selection,
		reading,
		get innerBlockRefs() {
			return listState.innerBlockRefs;
		},
		refSlots: listState.refSlots,
		get nodeChildrenLength() {
			return node.children?.length ?? 0;
		},
		get node() {
			return node;
		},
		revealChild: windowing.revealChild,
		isInWindow: windowing.isInWindow
	});
</script>

<div class="list-block" bind:this={boxEl}>
	{#if win.active}
		<div class="vr-spacer" style="height: {win.topSpacerPx}px"></div>
	{/if}
	<!-- `index`, `myPath` and the key are all the absolute item index
	     (bounds.start + localIndex), never the local loop index — paths and
	     structural ops key off it. -->
	{#each (node.children ?? []).slice(bounds.start, bounds.end) as item, localIndex (listState.innerBlockIds[bounds.start + localIndex])}
		{@const absoluteIndex = bounds.start + localIndex}
		<ListItemBlock
			node={item}
			index={absoluteIndex}
			myPath={[...myPath, absoluteIndex]}
			itemCount={(node.children ?? []).length}
			slots={listState.refSlots}
		/>
	{/each}
	{#if win.active}
		<div class="vr-spacer" style="height: {win.bottomSpacerPx}px"></div>
	{/if}
</div>

<style>
	.list-block {
		margin: 4px 0;
	}
</style>
