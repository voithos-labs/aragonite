<script module lang="ts">
	import { calloutPlugin } from '../callout/register';
	import { detailsPlugin } from '$lib/plugins/details';

	// Module scope so each factory runs once per process, not once per (SSR) render:
	// re-minting fresh same-name plugin objects each render would trip installPlugins'
	// first-wins dev-warn (the stable-array pattern a consumer copies). Editor 2's array
	// adds detailsPlugin, which editor 1 never had — the staggered late-mount this
	// harness exists to exercise.
	const callout = calloutPlugin();
	const editorOnePlugins = [callout];
	const editorTwoPlugins = [callout, detailsPlugin()];

	// One seed holding both a callout and a `<details>`. Editor 1 parses it under
	// callout only, so `<details>` falls to the built-in htmlBlock; editor 2 parses
	// the same bytes after detailsPlugin has registered, so `<details>` resolves to
	// the `details` plugin kind.
	const SEED = [
		':::note Title',
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

	// Minimal per-editor bridges: this harness's e2e only reads the CST by path, so
	// each editor exposes just getDocument(). installTestProbes is single-editor (it
	// hardcodes window.__test), so editor 2 gets a distinct handle rather than
	// clobbering editor 1's.
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
