<script module lang="ts">
	import { calloutPlugin } from '../callout/register';
	import { detailsPlugin } from '$lib/plugins/details';

	// Editor 2 adds detailsPlugin — the staggered late-mount this harness exercises.
	const callout = calloutPlugin();
	const editorOnePlugins = [callout];
	const editorTwoPlugins = [callout, detailsPlugin()];

	// Editor 1 parses these bytes under callout only, so `<details>` falls to the built-in
	// htmlBlock; editor 2 parses them after detailsPlugin registered, so it resolves.
	const SEED = [
		':::callout Title',
		'First',
		':::',
		'',
		'<details open>',
		'<summary>Summary</summary>',
		'',
		'Body',
		'',
		'</details>',
		''
	].join('\n');
</script>

<script lang="ts">
	import { Editor } from '$lib';
	import { trackParityDocument } from '../../../parity-documents.svelte';

	let editorOne = $state<ReturnType<typeof Editor>>();
	let editorTwo = $state<ReturnType<typeof Editor>>();
	let secondMounted = $state(false);

	// Both editors, not just the `__test` one: the teardown parity walk reads this
	// registry, and editor 2 is the one under test here.
	trackParityDocument(() => editorOne);
	trackParityDocument(() => editorTwo);

	// Minimal per-editor bridges: installTestProbes is single-editor (it hardcodes
	// window.__test), so editor 2 gets a distinct handle rather than clobbering editor 1's.
	$effect(() => {
		if (!editorOne) return;
		(window as unknown as { __test: unknown }).__test = {
			getDocument: () => editorOne!.__test.getDocument()
		};
	});
	$effect(() => {
		if (!editorTwo) return;
		(window as unknown as { __test2: unknown }).__test2 = {
			getDocument: () => editorTwo!.__test.getDocument()
		};
	});
</script>

<div class="plugins-harness aragonite-editor-theme">
	<div class="harness-controls">
		<button onclick={() => (secondMounted = true)} data-testid="mount-second">
			Mount second editor
		</button>
	</div>
	<Editor bind:this={editorOne} source={SEED} plugins={editorOnePlugins} />
	{#if secondMounted}
		<Editor bind:this={editorTwo} source={SEED} plugins={editorTwoPlugins} />
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
