<script lang="ts">
	import type { CstNode, BlockComponent, AmbientPrefix } from '../contracts';
	import BlockHost from './BlockHost.svelte';

	// setRef/getRef are owner-supplied callbacks. A bind:blockRefs $bindable
	// array desyncs from the owner's state across cross-effect mutations.
	let {
		children,
		blockIds,
		setRef,
		getRef,
		parentPath = [],
		ambientPrefixForFirst = ''
	}: {
		children: CstNode[];
		blockIds: string[];
		setRef: (i: number, r: BlockComponent | undefined) => void;
		getRef: (i: number) => BlockComponent | undefined;
		parentPath?: number[];
		ambientPrefixForFirst?: AmbientPrefix;
	} = $props();
</script>

<div class="block-list">
	{#each children as node, i (blockIds[i])}
		<BlockHost
			{node}
			index={i}
			{parentPath}
			ambientPrefix={i === 0 ? ambientPrefixForFirst : ''}
			{setRef}
			{getRef}
		/>
	{/each}
</div>

<style>
	.block-list {
		display: flex;
		flex-direction: column;
	}
</style>
