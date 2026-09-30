<script lang="ts">
	// A childless opaque container built on the public API, like a diagram whose only edit path
	// is its own UI. No BlockList: the factory supplies the whole focusable element, and the
	// kind descriptor supplies the `editable` the mounted block reports.
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
