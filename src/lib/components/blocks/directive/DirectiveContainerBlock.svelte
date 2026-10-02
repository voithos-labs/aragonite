<script lang="ts">
	// How an unregistered `:::name` directive renders, built on the same `createContainerBlock`
	// helper a plugin gets from the public barrel. Its marker is a dimmed line over a left
	// border, not a card box: a document should look like a document.
	import { createContainerBlock } from '$lib/editor-actions/plugin/container';
	import BlockList from '$lib/components/BlockList.svelte';
	import type { NodeView } from '$lib/core/node-views';
	import { firstDisplayLine } from '$lib/core/lines';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	let boxEl: HTMLElement | undefined = $state();

	// The opener line sliced verbatim, not rebuilt from metadata: the line can also
	// carry an indent, attributes, or trailing spaces the metadata does not hold.
	const marker = $derived(firstDisplayLine(node.raw).text);

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
	<span class="directive-marker" contenteditable="false">{marker}</span>
	<BlockList {...blockListProps} />
</div>

<style>
	.directive-block {
		border-left: 2px solid var(--color-ui-muted, #a4a4a4);
		padding-left: 0.75em;
		margin: 6px 0;
	}
	.directive-marker {
		display: block;
		font-family: var(--font-code, ui-monospace, monospace);
		opacity: var(--syntax-marker-dim, 0.65);
		user-select: none;
		-webkit-user-select: none;
		cursor: default;
	}
</style>
