<script lang="ts">
	import type { AmbientPrefix, BlockComponent } from '../block-component';
	import type { CstNode } from '../core/nodes';
	import type { WindowResult } from '../reactivity/block-window.svelte';
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
	let start = $derived(active ? win!.start : 0);
	let end = $derived(active ? win!.end : children.length);
	let slice = $derived(children.slice(start, end));
	let pinnedIndex = $derived(win?.pinnedOutside ? win!.pinnedIndex : null);
</script>

{#if active}
	<div class="block-list block-list--windowed">
		<div class="vr-spacer" style="height: {win!.topSpacerPx}px"></div>
		{#each slice as node, localIndex (blockIds[start + localIndex])}
			{@const absoluteIndex = start + localIndex}
			<!-- ABSOLUTE-INDEX INVARIANT: index/id/key are the absolute child index
			     (start + localIndex), never the local loop index — paths and structural
			     ops key off it. -->
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

		{#if pinnedIndex !== null && win!.pinnedOffsetPx !== null}
			{@const node = children[pinnedIndex]}
			<!-- Caret block scrolled outside the window: keep it mounted so native
			     focus/IME survive, positioned absolutely at its true offset so it does
			     not disturb the spacer-based scroll height. Off-screen, so invisible. -->
			<div class="vr-pinned" style="top: {win!.pinnedOffsetPx}px">
				<BlockHost
					{node}
					index={pinnedIndex}
					id={blockIds[pinnedIndex]}
					{parentPath}
					ambientPrefix={pinnedIndex === 0 ? ambientPrefixForFirst : ''}
					{setRef}
					{getRef}
				/>
			</div>
		{/if}
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
	/* Only the windowed branch becomes a containing block for the absolutely
	   positioned pin. The inactive branch stays byte-identical to the
	   pre-window markup so nested abs-positioned descendants (image popover,
	   resize handles) keep resolving to their existing ancestor. */
	.block-list--windowed {
		position: relative;
	}
	.vr-spacer {
		flex: 0 0 auto;
	}
	.vr-pinned {
		position: absolute;
		left: 0;
		right: 0;
	}
</style>
