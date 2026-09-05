<script lang="ts">
	// A childless opaque container on the public seam — the diagram whose only edit path would
	// be its own UI. No BlockList: the factory supplies the whole caret surface, and the kind's
	// descriptor supplies the `editable` the mounted surface reports.
	import { createContainerBlock, type NodeView } from '$lib/plugin';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	let boxEl: HTMLElement | undefined = $state();

	const { containerApi, handleKeydown } = createContainerBlock({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getBoxEl: () => boxEl,
		getFocusEl: () => boxEl?.querySelector<HTMLElement>('.opaque-surface') ?? null
	});

	export { containerApi };
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="opaque-container" bind:this={boxEl} onkeydown={handleKeydown}>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div class="opaque-surface" tabindex="0" role="img" aria-label="Opaque fixture">{node.raw}</div>
</div>
