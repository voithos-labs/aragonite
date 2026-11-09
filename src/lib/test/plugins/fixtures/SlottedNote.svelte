<script lang="ts">
	import type { SvelteBlockProps } from '#lib/components/drawn-block/svelte-block.svelte.js';
	import type { TextDrawContext } from '#lib/schema/drawing.js';

	let { block, ctx, Slot }: SvelteBlockProps<never, TextDrawContext> = $props();
</script>

<span class="caption" data-focused={ctx.focused}>{block.body}</span>
<Slot of="source" />
