<script lang="ts">
	import { createContainerBlock } from '../../editor-actions/plugin/container';
	import type { NodeView } from '../../core/node-views';
	import BlockList from '../BlockList.svelte';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	let boxEl: HTMLElement | undefined = $state();

	// Blockquote is a plain strip container, so the seam wires it end to end. Its
	// collapse gates and kind-command target stay inert (no reservedChrome probe, no
	// keymap), and `handleKeydown` is deliberately left unwired — a blockquote never
	// bubbled kind commands, and attaching it would add that behavior.
	const { blockListProps, containerApi } = createContainerBlock({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getBoxEl: () => boxEl
	});

	export { containerApi };
</script>

<div class="blockquote-block" bind:this={boxEl}>
	<BlockList {...blockListProps} reorderable={true} />
</div>

<style>
	.blockquote-block {
		border-left: 3px solid var(--color-ui-muted, #a4a4a4);
		padding-left: 16px;
		margin: 4px 0;
	}
</style>
