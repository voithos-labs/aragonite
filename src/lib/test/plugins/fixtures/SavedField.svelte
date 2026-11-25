<!-- A field over its fence's body, written only when the editor asks it to save; its handle focuses it. -->
<script lang="ts">
	import {
		useDrawn,
		type SvelteBlockProps
	} from '#lib/components/drawn-block/svelte-block.svelte.js';
	import type { BoxDrawContext } from '#lib/schema/drawing.js';

	let { block, ctx }: SvelteBlockProps<never, BoxDrawContext> = $props();
	let field: HTMLTextAreaElement | undefined = $state();
	useDrawn(() => ({
		save: () => {
			if (field && field.value !== block.body)
				void ctx.editor.edit().body(block, field.value).commit();
		},
		handle: { focus: () => field?.focus() }
	}));
</script>

<textarea bind:this={field} class="saved-field" value={block.body}></textarea>
