<script lang="ts">
	import type { SvelteBlockProps } from '#lib/components/drawn-block/svelte-block.svelte.js';
	import type { ContainerDrawContext } from '#lib/schema/drawing.js';

	let { Slot }: SvelteBlockProps<never, ContainerDrawContext> = $props();
	// A JavaScript caller can still name the title row, which no slot places.
	const title = 'title' as 'children';
</script>

<div class="frame"><Slot of={title} /><Slot of="children" /></div>
