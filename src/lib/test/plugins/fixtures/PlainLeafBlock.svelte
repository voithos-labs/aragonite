<script lang="ts">
	// The plugin guide's plain-mode editable-leaf recipe as a mountable fixture: one factory
	// call, one spread, and the `bind:this` the factory's `getEl` reads in both modes.
	import { createEditableLeaf, type NodeView } from '$lib/plugin';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	let sourceEl: HTMLDivElement | undefined = $state();

	const leaf = createEditableLeaf({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getEl: () => sourceEl ?? null,
		mode: 'plain'
	});

	export const blockApi = leaf.blockApi;
</script>

<div
	bind:this={sourceEl}
	{...leaf.surfaceProps}
	class="plain-leaf-block"
	aria-label="Plain leaf"
></div>

<style>
	.plain-leaf-block {
		/* The single-text-node rule counts every newline the DOM-to-offset traversal counts,
		   so a multi-line plain block has to show them too. */
		white-space: pre-wrap;
	}
</style>
