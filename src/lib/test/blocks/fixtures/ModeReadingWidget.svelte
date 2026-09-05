<script lang="ts">
	// The stand-in for an engine-painted inline widget: it renders nothing but the two live
	// terms, read inside a `$derived` so the pool's getters (not a mount-time snapshot) drive it.
	import type { InlineWidgetComponentProps } from '$lib/core/inline/inline-widgets';

	let { getPresentationMode, getTheme }: InlineWidgetComponentProps = $props();

	// 'absent' rather than the production defaults: an unthreaded getter must read as a
	// missing channel, not as a plausible value.
	const mode = $derived(getPresentationMode?.() ?? 'absent');
	const theme = $derived(getTheme?.() ?? 'absent');
</script>

<span class="mode-reading-widget">{mode}/{theme}</span>
