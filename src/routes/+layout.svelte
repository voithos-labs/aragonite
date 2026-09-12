<script lang="ts">
	import type { Snippet } from 'svelte';
	// The host app's own faces, from the packages it uses, so the demo reads as that app
	// rather than as whatever the browser's system-ui happens to be. devDependencies: they
	// reach these routes, never the published package.
	import '@fontsource/inter/400.css';
	import '@fontsource/inter/500.css';
	import '@fontsource/inter/600.css';
	import '@fontsource/jetbrains-mono/400.css';
	import '@fontsource/jetbrains-mono/700.css';
	import '../app.css';
	import '$lib/styles/editor-theme.css';

	let { children }: { children: Snippet } = $props();
</script>

{@render children()}
