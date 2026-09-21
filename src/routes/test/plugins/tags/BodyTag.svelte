<script lang="ts">
	/**
	 * The rendered tag: a chip carrying its own `#name` bytes. Ctrl/Cmd-click (a plain click in
	 * reading mode) is the activation gesture a host turns into navigation; the harness only
	 * records it, so a battery can assert the gesture reached the widget.
	 */
	import { isWidgetActivationClick, type InlineWidgetComponentProps } from '$lib/plugin';

	let { source, getPresentationMode }: InlineWidgetComponentProps = $props();

	function onClick(e: MouseEvent): void {
		const mode = getPresentationMode?.() ?? 'source';
		if (!isWidgetActivationClick(e.ctrlKey || e.metaKey, mode)) return;
		e.preventDefault();
		const probe = window as Window & { __tagActivations?: string[] };
		(probe.__tagActivations ??= []).push(source.slice(1));
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<span class="body-tag" data-tag={source.slice(1)} onclick={onClick}>{source}</span>

<style>
	.body-tag {
		padding: 0.05em 0.45em;
		border-radius: 999px;
		background: var(--color-ui-faint, rgba(255, 255, 255, 0.07));
		color: var(--color-accent, #567b67);
		cursor: pointer;
	}
</style>
