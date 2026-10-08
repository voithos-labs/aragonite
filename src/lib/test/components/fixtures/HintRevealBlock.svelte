<script lang="ts">
	// A render-primary leaf whose folded view shows the hint its source would show, so a test can
	// read the hint while no source element exists.
	import { createEditableLeaf, type NodeView } from '#lib/plugin.js';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	let sourceEl: HTMLDivElement | undefined = $state();
	let revealed = $state(false);

	const leaf = createEditableLeaf({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getEl: () => sourceEl ?? null,
		mode: 'render-primary',
		isRevealed: () => revealed,
		setRevealed: (next) => {
			revealed = next;
		}
	});

	export const blockApi = leaf.blockApi;
</script>

{#if revealed}
	<div bind:this={sourceEl} {...leaf.surfaceProps} class="hint-source-block"></div>
{:else}
	<div
		class="hint-rendered-block"
		role="button"
		tabindex="-1"
		aria-label="Hint block (click to edit)"
		data-folded-hint={leaf.surfaceProps['data-placeholder'] ?? ''}
		{...leaf.renderProps}
	></div>
{/if}
