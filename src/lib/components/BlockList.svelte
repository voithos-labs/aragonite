<script lang="ts">
	import type { AmbientPrefix, BlockComponent } from '../block-component';
	import type { NodeView } from '../core/node-views';
	import type { WindowResult } from '../reactivity/block-window.svelte';
	import type { RefSlots } from '../reactivity/publish-ref.svelte';
	import { sliceWindow } from '../reactivity/window-slice';
	import BlockHost from './BlockHost.svelte';

	// `slots` is owner-supplied: a `bind:` $bindable array desyncs from the owner's state
	// across cross-effect mutations. `reorderable` is true only when these children ARE
	// reorder units (document root, list, blockquote).
	let {
		children,
		blockIds,
		slots,
		parentPath = [],
		ambientPrefixForFirst = '',
		window: win = undefined,
		reorderable = false
	}: {
		children: readonly NodeView[];
		blockIds: string[];
		slots: RefSlots<BlockComponent>;
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
		<!-- ABSOLUTE-INDEX INVARIANT: index/id/key are `start + localIndex`, never the
		     local loop index — paths and structural ops key off it. -->
		<BlockHost
			{node}
			index={absoluteIndex}
			id={blockIds[absoluteIndex]}
			{parentPath}
			ambientPrefix={absoluteIndex === 0 ? ambientPrefixForFirst : ''}
			{slots}
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
