<script lang="ts">
	import type { MenuRow, MenuRowProps } from '#lib/plugin.js';

	let { row }: MenuRowProps<MenuRow> = $props();
</script>

<button type="button" class="host-button">{row.label}</button>
