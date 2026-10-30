<script lang="ts">
	import { createContainerBlock } from '../../editor-actions/plugin/container';
	import type { NodeView } from '../../core/node-views';
	import BlockList from '../BlockList.svelte';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	let boxEl: HTMLElement | undefined = $state();

	// A plain container with a left border: `createContainerBlock` wires it end to end. Its keymap
	// is empty, so `handleKeydown` runs only a consumer's `blockquote`-scoped binding.
	const { blockListProps, containerApi, handleKeydown } = createContainerBlock({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getBoxEl: () => boxEl
	});

	export { containerApi };
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="blockquote-block" bind:this={boxEl} onkeydown={handleKeydown}>
	<BlockList {...blockListProps} />
</div>

<style>
	.blockquote-block {
		border-left: 3px solid var(--color-ui-muted);
		padding-left: 16px;
		margin: 4px 0;
	}
</style>
