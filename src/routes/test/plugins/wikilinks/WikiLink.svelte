<script lang="ts">
	/**
	 * The rendered link: the note's name, followed on any click as a link on a web page is. A host
	 * opens the note there; the harness only records it, so a spec can check that the click
	 * reached the widget and that the editor left it mounted.
	 */
	import type { InlineWidgetComponentProps } from '$lib/plugin';

	let { source }: InlineWidgetComponentProps = $props();

	const target = $derived(source.slice(2, -2));

	function onClick(e: MouseEvent): void {
		// A drag that began and ended on the link is a selection, not a click on it
		if (!(window.getSelection()?.isCollapsed ?? true)) return;
		e.preventDefault();
		const probe = window as Window & { __linkActivations?: string[] };
		(probe.__linkActivations ??= []).push(target);
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<span class="wikilink" data-target={target} onclick={onClick}>{target}</span>

<style>
	.wikilink {
		color: var(--color-accent, #567b67);
		text-decoration: underline;
		cursor: pointer;
	}
</style>
