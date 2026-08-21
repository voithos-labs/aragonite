<script lang="ts">
	// The generic render surface for an unregistered `:::name` directive, built on the
	// same `createContainerBlock` seam a plugin reaches through the barrel. Chrome stays a
	// dimmed marker over a gutter rail, not a card box — a document should feel like a document.
	import { createContainerBlock } from '$lib/editor-actions/plugin/container';
	import BlockList from '$lib/components/BlockList.svelte';
	import type { NodeView } from '$lib/core/node-views';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	let boxEl: HTMLElement | undefined = $state();

	// The opener line sliced verbatim, not rebuilt from metadata: the line can also
	// carry an indent, attributes, or trailing spaces the metadata does not hold.
	const marker = $derived.by(() => {
		const end = node.raw.indexOf('\n');
		const line = end === -1 ? node.raw : node.raw.slice(0, end);
		return line.endsWith('\r') ? line.slice(0, -1) : line;
	});

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
		font-family: var(--font-editor, ui-monospace, monospace);
		opacity: var(--syntax-marker-dim, 0.65);
		user-select: none;
		-webkit-user-select: none;
		cursor: default;
	}
</style>
