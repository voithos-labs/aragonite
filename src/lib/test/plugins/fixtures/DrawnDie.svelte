<!-- A box drawn whole as a button, which takes the caret the editor hands the box. -->
<script lang="ts">
	import {
		useDrawn,
		type SvelteBlockProps
	} from '#lib/components/drawn-block/svelte-block.svelte.js';
	import type { BoxDrawContext } from '#lib/schema/drawing.js';

	let { block }: SvelteBlockProps<never, BoxDrawContext> = $props();
	let button: HTMLButtonElement | undefined = $state();
	useDrawn(() => ({
		focus: {
			enter: () => button?.focus(),
			offset: () => (document.activeElement === button ? 0 : null)
		}
	}));
</script>

<button bind:this={button} class="die">{block.text}</button>
