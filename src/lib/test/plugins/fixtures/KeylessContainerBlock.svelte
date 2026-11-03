<!-- A plugin container that binds no keydown of its own, and one that binds it and stops every key
     it sees: its kind's chords must still run from a block inside, and from its own button. -->
<script lang="ts">
	import type { NodeView } from '#lib/plugin.js';
	import { BlockList, createContainerBlock } from '#lib/svelte.js';

	let {
		node,
		index,
		myPath = [],
		stops = false
	}: { node: NodeView; index: number; myPath?: number[]; stops?: boolean } = $props();
	let boxEl: HTMLElement | undefined = $state();

	const { blockListProps, containerApi, handleKeydown } = createContainerBlock({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getBoxEl: () => boxEl
	});

	function stopEveryKey(e: KeyboardEvent): void {
		handleKeydown(e);
		e.stopPropagation();
	}

	export { containerApi };
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="keyless-container" bind:this={boxEl} onkeydown={stops ? stopEveryKey : undefined}>
	<button class="container-chrome">kind</button>
	<BlockList {...blockListProps} />
</div>
