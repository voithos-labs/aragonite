<script lang="ts">
	import type { CstNode, BlockComponent } from '../editor-types';
	import BlockHost from './BlockHost.svelte';

	let {
		children,
		blockIds,
		blockRefs = $bindable([]),
		parentPath = []
	}: {
		children: CstNode[];
		blockIds: string[];
		blockRefs?: (BlockComponent | undefined)[];
		parentPath?: number[];
	} = $props();
</script>

<div class="block-list">
	{#each children as node, i (blockIds[i])}
		<BlockHost {node} index={i} {parentPath} bind:ref={blockRefs[i]} />
	{/each}
</div>

<style>
	.block-list {
		display: flex;
		flex-direction: column;
	}
</style>
