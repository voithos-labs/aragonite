<script lang="ts">
	import type { AmbientPrefix, BlockComponent } from '../block-component';
	import type { CstNode } from '../core/nodes';
	import type { WindowResult } from '../reactivity/block-window.svelte';
	import { sliceWindow } from '../reactivity/window-slice';
	import BlockHost from './BlockHost.svelte';

	// setRef/getRef are owner-supplied callbacks. A bind:blockRefs $bindable
	// array desyncs from the owner's state across cross-effect mutations.
	let {
		children,
		blockIds,
		setRef,
		getRef,
		parentPath = [],
		ambientPrefixForFirst = '',
		window: win = undefined
	}: {
		children: CstNode[];
		blockIds: string[];
		setRef: (i: number, r: BlockComponent | undefined) => void;
		getRef: (i: number) => BlockComponent | undefined;
		parentPath?: number[];
		ambientPrefixForFirst?: AmbientPrefix;
		window?: WindowResult;
	} = $props();

	let active = $derived(win?.active ?? false);
	let bounds = $derived(sliceWindow(children.length, win));
	let start = $derived(bounds.start);
	let end = $derived(bounds.end);
	let slice = $derived(children.slice(start, end));
</script>

{#if active}
	<div class="block-list">
		<div class="vr-spacer" style="height: {win!.topSpacerPx}px"></div>
		{#each slice as node, localIndex (blockIds[start + localIndex])}
			{@const absoluteIndex = start + localIndex}
			<!-- ABSOLUTE-INDEX INVARIANT: index/id/key are the absolute child index
			     (start + localIndex), never the local loop index — paths and structural
			     ops key off it. The focused block stays in this each via the window's
			     contiguous pin-extension, so its DOM node (and focus/IME) survive scroll. -->
			<BlockHost
				{node}
				index={absoluteIndex}
				id={blockIds[absoluteIndex]}
				{parentPath}
				ambientPrefix={absoluteIndex === 0 ? ambientPrefixForFirst : ''}
				{setRef}
				{getRef}
			/>
		{/each}
		<div class="vr-spacer" style="height: {win!.bottomSpacerPx}px"></div>
	</div>
{:else}
	<div class="block-list">
		{#each children as node, i (blockIds[i])}
			<BlockHost
				{node}
				index={i}
				id={blockIds[i]}
				{parentPath}
				ambientPrefix={i === 0 ? ambientPrefixForFirst : ''}
				{setRef}
				{getRef}
			/>
		{/each}
	</div>
{/if}

<style>
	.block-list {
		display: flex;
		flex-direction: column;
	}
	.vr-spacer {
		flex: 0 0 auto;
	}
</style>
