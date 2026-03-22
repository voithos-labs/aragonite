<!-- src/lib/editor/components/BlockList.svelte -->
<script lang="ts">
	import type { MutableNode, BlockComponent } from '../editor-types';
	import BlockHost from './BlockHost.svelte';

	let {
		children,
		blockIds,
		blockRefs = $bindable([])
	}: {
		children: MutableNode[];
		blockIds: string[];
		blockRefs?: (BlockComponent | undefined)[];
	} = $props();
</script>

<div class="block-list">
	{#each children as node, i (blockIds[i])}
		<BlockHost {node} index={i} bind:ref={blockRefs[i]} />
	{/each}
</div>

<style>
	.block-list {
		display: flex;
		flex-direction: column;
	}
</style>
