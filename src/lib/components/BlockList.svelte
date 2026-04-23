<script lang="ts">
	import type { CstNode, BlockComponent, AmbientPrefix } from '../contracts';
	import BlockHost from './BlockHost.svelte';

	let {
		children,
		blockIds,
		blockRefs = $bindable([]),
		parentPath = [],
		ambientPrefixForFirst = ''
	}: {
		children: CstNode[];
		blockIds: string[];
		blockRefs?: (BlockComponent | undefined)[];
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
			bind:ref={blockRefs[i]}
		/>
	{/each}
</div>

<style>
	.block-list {
		display: flex;
		flex-direction: column;
	}
</style>
