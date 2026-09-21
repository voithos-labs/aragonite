<script lang="ts">
	// A plugin container on the public `@voithos-labs/aragonite/plugin` API: `createContainerBlock`
	// hides every editor internal, so this component supplies only the box around BlockList.
	import { BlockList, createContainerBlock, type NodeView } from '$lib/plugin';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	let boxEl: HTMLElement | undefined = $state();

	const { blockListProps, containerApi, handleKeydown } = createContainerBlock({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getBoxEl: () => boxEl
	});

	export { containerApi };
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="callout-block" bind:this={boxEl} onkeydown={handleKeydown}>
	<BlockList {...blockListProps} />
</div>

<style>
	/* A pseudo-element icon is a style choice, not a requirement: windowing's
	   `:scope > .block-list` lookup needs BlockList to stay a direct child, not the only one. */
	.callout-block {
		position: relative;
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: 6px;
		background: color-mix(in srgb, var(--color-ui-muted, #a4a4a4) 8%, transparent);
		padding: 8px 12px 8px 34px;
		margin: 6px 0;
	}
	.callout-block::before {
		content: 'ℹ';
		position: absolute;
		left: 10px;
		top: 8px;
		font-size: 14px;
		line-height: 1.4;
		color: var(--color-text-muted, #aaaaaa);
	}

	/* CSS makes the `callout-title` leaf look like a title row, but it stays a real block inside
	   the one `.block-list`, so selection and windowing treat it as an ordinary child. */
	.callout-block :global(.callout-title) {
		font-weight: 600;
		border-bottom: 1px solid var(--color-ui-muted, #a4a4a4);
		margin-bottom: 4px;
		padding-bottom: 4px;
	}
	.callout-block :global(.callout-title:empty)::before {
		content: 'Title';
		color: var(--color-ui-dulled, #afb1b3);
		pointer-events: none;
	}
</style>
