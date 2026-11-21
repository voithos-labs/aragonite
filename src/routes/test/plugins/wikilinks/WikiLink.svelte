<script lang="ts">
	/** The rendered link: the note's name. The editor runs the plugin's `follow` on the click. */
	import type { WidgetProps } from '#lib/plugin.js';

	let { data }: WidgetProps<{ target: string }> = $props();
</script>

<span class="wikilink" data-target={data.target}>{data.target}</span>

<style>
	.wikilink {
		color: var(--color-accent);
		text-decoration: underline;
		cursor: pointer;
	}
</style>
