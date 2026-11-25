<script module lang="ts">
	import { conspiracyPlugin } from '../../plugins/conspiracy/conspiracy-plugin';
	import { routePlugins } from './plugins';

	// Module scope, so the list is built once per process, not once per (SSR) render.
	const plugins = routePlugins(conspiracyPlugin);
</script>

<script lang="ts">
	import { type EditorInstance } from '@voithos-labs/aragonite';
	import { Editor } from '@voithos-labs/aragonite/svelte';
	import '@voithos-labs/aragonite/styles/editor-theme.css';
	import { PLUGINS_SEED } from './seed';

	let editor = $state<EditorInstance>();

	// Round-trip probe for the boundary smoke specs.
	$effect(() => {
		if (!editor) return;
		(window as { __consumer?: { getSource: () => string } }).__consumer = {
			getSource: () => editor!.getSource()
		};
	});
</script>

<Editor bind:this={editor} source={PLUGINS_SEED} theme="light" {plugins} />
