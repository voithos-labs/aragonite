<script lang="ts">
	// How an unregistered `:::name` directive renders, built on the same `createContainerBlock`
	// helper a plugin gets from the public barrel. Its opener line is its first child, over a left
	// border, not a card box: a document should look like a document.
	import { createContainerBlock } from '#lib/editor-actions/plugin/container.js';
	import BlockList from '#lib/components/BlockList.svelte';
	import type { NodeView } from '#lib/core/node-views.js';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	let boxEl: HTMLElement | undefined = $state();

	const { blockListProps, containerApi, handleKeydown } = createContainerBlock({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getBoxEl: () => boxEl
	});

	export { containerApi };
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="directive-block" bind:this={boxEl} onkeydown={handleKeydown}>
	<BlockList {...blockListProps} />
</div>

<style>
	.directive-block {
		border-left: 2px solid var(--color-ui-muted);
		padding-left: 0.75em;
		margin: 6px 0;
	}
	.directive-block
		> :global(.block-list > [data-block-kind='directiveOpenerLine'] .directive-opener-line) {
		font-family: var(--font-code, ui-monospace, monospace);
	}
</style>
