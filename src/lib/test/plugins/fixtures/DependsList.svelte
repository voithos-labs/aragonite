<script lang="ts">
	// A `svelteBlock` component that lists the answers its block type's `depends` gave.
	import type { SvelteBlockProps } from '#lib/svelte.js';

	let { ctx }: SvelteBlockProps = $props();
</script>

<nav>{ctx.depends.filter(Boolean).join('|')}</nav>
