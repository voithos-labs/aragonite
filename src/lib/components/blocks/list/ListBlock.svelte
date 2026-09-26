<script lang="ts">
	import { getContext, setContext } from 'svelte';
	import type { ListContext } from '../../../action-contracts';
	import type { NodeView } from '../../../core/node-views';
	import { EDITOR_SERVICES_KEY, LIST_CONTEXT_KEY, type EditorServices } from '../../../editor-keys';
	import { createListContext } from '../../../editor-actions/list-context';
	import { createListOverrides } from '../../../editor-actions/list-overrides';
	import { useContainerWindowing } from '../../../reactivity/use-container-windowing.svelte';
	import { sliceWindow } from '../../../reactivity/window-slice';
	import { createContainerActions } from '../../../editor-actions/nested/container-actions';
	import { createContainerBlockComponent } from '../../../editor-actions/container-block-component';
	import ListItemBlock from './ListItemBlock.svelte';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	const { controller, selection } = getContext<EditorServices>(EDITOR_SERVICES_KEY);

	let boxEl: HTMLElement | undefined = $state();

	// Read before this list provides its own below.
	const parentListContext = getContext<ListContext | undefined>(LIST_CONTEXT_KEY);

	const {
		scope,
		state: listState,
		parent,
		reading
	} = createContainerActions({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		parentListContext,
		overrides: ({ scope, parent }) =>
			createListOverrides({ scope, parentBlockEdit: parent.blockEdit })
	});

	const listContext = createListContext({
		scope,
		getLineEnding: () => parent.containerEdit.lineEnding(),
		state: listState,
		parentBlockEdit: parent.blockEdit,
		parentFocus: parent.focus,
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

<!-- The items reorder among themselves, which the drag reads off this mark. -->
<div class="list-block" data-reorder-scope bind:this={boxEl}>
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
