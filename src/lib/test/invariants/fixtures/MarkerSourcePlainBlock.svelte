<script lang="ts">
	// A plain-mode leaf using the platform's own caret call, painting its bytes as markers: the
	// single-text-node sync leaves the span alone, since its textContent already matches, so the
	// shared factory's `parkCaret` puts a caret where the mode paints nothing.
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

<div bind:this={sourceEl} {...leaf.surfaceProps} class="marker-plain-block">
	<span class="md-marker">{leaf.sourceText}</span>
</div>
