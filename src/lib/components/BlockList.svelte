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

	// Defined outside the each so the prop reference stays stable —
	// per-iteration closures would re-fire the child's publish effect.
	function setBlockRef(i: number, r: BlockComponent | undefined): void {
		blockRefs[i] = r;
	}
	function getBlockRef(i: number): BlockComponent | undefined {
		return blockRefs[i];
	}
</script>

<div class="block-list">
	{#each children as node, i (blockIds[i])}
		<BlockHost
			{node}
			index={i}
			{parentPath}
			ambientPrefix={i === 0 ? ambientPrefixForFirst : ''}
			setRef={setBlockRef}
			getRef={getBlockRef}
		/>
	{/each}
</div>

<style>
	.block-list {
		display: flex;
		flex-direction: column;
	}
</style>
