<script lang="ts">
	// The marker rides the first child as an ambient prefix (the listItem `- ` model),
	// so the body edits like ordinary prose while the marker stays read-only chrome.
	import { BlockList, createContainerBlock, getPluginMetadata, type NodeView } from '$lib/plugin';
	import type { FootnoteDefMetadata } from './footnote-definition';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	let boxEl: HTMLElement | undefined = $state();

	const label = $derived(getPluginMetadata<FootnoteDefMetadata>(node)?.label ?? '');

	const { blockListProps, containerApi } = createContainerBlock({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getBoxEl: () => boxEl,
		getAmbientPrefix: () => `[^${label}]: `
	});

	export { containerApi };
</script>

<div class="footnote-def" data-footnote-label={label} bind:this={boxEl}>
	<BlockList {...blockListProps} />
</div>

<style>
	/* A gutter rail, not card chrome: the marker itself is the child leaf's prefix span. */
	.footnote-def {
		position: relative;
		margin: 0.4em 0;
		padding-left: 0.9em;
		border-left: 2px solid var(--color-border, #3d4047);
		font-size: 0.95em;
	}
</style>
