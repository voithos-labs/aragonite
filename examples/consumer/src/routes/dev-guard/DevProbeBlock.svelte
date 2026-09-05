<script lang="ts">
	import { BlockList, createContainerBlock, type NodeView } from '@voithos-labs/aragonite/plugin';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	let boxEl: HTMLElement | undefined = $state();

	const { blockListProps, containerApi } = createContainerBlock({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getBoxEl: () => boxEl,
		// Deliberate disagreement: the devprobe descriptor declares no collapse probe, so
		// this `true` trips composeCollapseProbe's dev-warn at render.
		isCollapsed: () => true
	});

	export { containerApi };
</script>

<div class="devprobe-block" bind:this={boxEl}>
	<BlockList {...blockListProps} />
</div>
