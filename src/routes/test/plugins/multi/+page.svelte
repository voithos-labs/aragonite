<script module lang="ts">
	import { docStatsPlugin } from '../doc-stats/doc-stats-plugin';

	// Module scope so the entry arrays stay identity-stable across (SSR) renders:
	// installPlugins skips a same-object re-install silently, and per-instance options
	// ride the entries — one plugin object, two labels.
	const leftPlugins = [{ plugin: docStatsPlugin, options: { label: 'left' } }];
	const rightPlugins = [{ plugin: docStatsPlugin, options: { label: 'right' } }];
</script>

<script lang="ts">
	import { Editor } from '$lib';
	import { trackParityDocument } from '../../../parity-documents.svelte';

	let showRight = $state(true);
	let left = $state<ReturnType<typeof Editor>>();
	let right = $state<ReturnType<typeof Editor>>();

	trackParityDocument(() => left);
	trackParityDocument(() => right);
</script>

<div class="plugins-harness aragonite-editor-theme">
	<div class="harness-controls">
		<button onclick={() => (showRight = !showRight)} data-testid="toggle-right">
			Toggle right editor
		</button>
	</div>
	<Editor bind:this={left} source={'# One\n'} plugins={leftPlugins} />
	{#if showRight}
		<Editor bind:this={right} source={'# Two\n\nPara\n'} plugins={rightPlugins} />
	{/if}
</div>

<style>
	.plugins-harness {
		width: 100vw;
		height: 100vh;
		display: flex;
		flex-direction: column;
	}

	.harness-controls {
		display: flex;
		gap: 0.5rem;
		padding: 0.4rem;
	}
</style>
