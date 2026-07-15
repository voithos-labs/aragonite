<script lang="ts">
	import type { AmbientPrefix, BlockComponent } from '../block-component';
	import type { NodeView } from '../core/node-views';
	import type { WindowResult } from '../reactivity/block-window.svelte';
	import { sliceWindow } from '../reactivity/window-slice';
	import BlockHost from './BlockHost.svelte';

	// setRef/getRef are owner-supplied callbacks. A bind:blockRefs $bindable
	// array desyncs from the owner's state across cross-effect mutations.
	// `reorderable` is true only when these children ARE reorder units (document
	// root, list, blockquote). A list item's inner content list passes false so its
	// paragraph gets no handle. Default false keeps new container call sites opt-in.
	let {
		children,
		blockIds,
		setRef,
		getRef,
		parentPath = [],
		ambientPrefixForFirst = '',
		window: win = undefined,
		reorderable = false
	}: {
		children: readonly NodeView[];
		blockIds: string[];
		setRef: (i: number, r: BlockComponent | undefined) => void;
		getRef: (i: number) => BlockComponent | undefined;
		parentPath?: number[];
		ambientPrefixForFirst?: AmbientPrefix;
		window?: WindowResult;
		reorderable?: boolean;
	} = $props();

	let active = $derived(win?.active ?? false);
	let bounds = $derived(sliceWindow(children.length, win));
	let start = $derived(bounds.start);
	let end = $derived(bounds.end);
	let slice = $derived(children.slice(start, end));
</script>

<div class="block-list">
	{#if active}
		<div class="vr-spacer" style="height: {win!.topSpacerPx}px"></div>
	{/if}
	{#each slice as node, localIndex (blockIds[start + localIndex])}
		{@const absoluteIndex = start + localIndex}
		<!-- ABSOLUTE-INDEX INVARIANT: index/id/key are the absolute child index
		     (start + localIndex), never the local loop index — paths and structural
		     ops key off it. When inactive, bounds are {0, childCount} so absoluteIndex
		     === i; the focused block stays in this each via the window's contiguous
		     pin-extension, so its DOM node (and focus/IME) survive scroll. -->
		<BlockHost
			{node}
			index={absoluteIndex}
			id={blockIds[absoluteIndex]}
			{parentPath}
			ambientPrefix={absoluteIndex === 0 ? ambientPrefixForFirst : ''}
			{setRef}
			{getRef}
			{reorderable}
		/>
	{/each}
	{#if active}
		<div class="vr-spacer" style="height: {win!.bottomSpacerPx}px"></div>
	{/if}
</div>

<style>
	.block-list {
		display: flex;
		flex-direction: column;
	}
	.vr-spacer {
		flex: 0 0 auto;
	}
</style>
