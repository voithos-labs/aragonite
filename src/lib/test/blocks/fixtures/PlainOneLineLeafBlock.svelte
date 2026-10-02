<script lang="ts">
	// A plain-mode editable leaf that is one line, whose source stays mounted and focusable in
	// reading mode, unlike a render-primary leaf's.
	import { createEditableLeaf, type NodeView } from '$lib/plugin';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	let sourceEl: HTMLDivElement | undefined = $state();

	const leaf = createEditableLeaf({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getEl: () => sourceEl ?? null,
		mode: 'plain',
		singleLine: true
	});

	export const blockApi = leaf.blockApi;
</script>

<div bind:this={sourceEl} {...leaf.surfaceProps} class="plain-one-line-source"></div>
