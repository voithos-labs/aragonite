<!-- A drawing whose handle can shut and nothing else: `check` runs a command reading `open` against it. -->
<script lang="ts">
	import {
		useDrawn,
		type SvelteBlockProps
	} from '#lib/components/drawn-block/svelte-block.svelte.js';
	import type { BoxDrawContext } from '#lib/schema/drawing.js';

	let { block }: SvelteBlockProps<never, BoxDrawContext> = $props();
	let shut = $state(false);
	useDrawn(() => ({ handle: { shut: () => void (shut = true) } }));
</script>

<div class="shut-handle" data-shut={shut}>{block.body}</div>
