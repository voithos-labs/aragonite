<script lang="ts">
	// A widget that marks itself when its editor calls a click its activation, through the prop.
	import type { InlineWidgetComponentProps } from '#lib/core/inline/inline-widgets.js';

	let { isActivationClick }: InlineWidgetComponentProps = $props();

	function onClick(e: MouseEvent): void {
		if (isActivationClick(e)) (e.currentTarget as HTMLElement).dataset.acted = '';
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<span class="activation-click-widget" onclick={onClick}>w</span>
