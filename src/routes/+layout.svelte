<script lang="ts">
	import type { Snippet } from 'svelte';
	import '../app.css';
	import '$lib/styles/editor-theme.css';

	let { children }: { children: Snippet } = $props();
</script>

{@render children()}
