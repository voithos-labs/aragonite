<script lang="ts">
	// An inline widget that renders only the presentation mode and theme, read inside a `$derived`
	// so the pool's getters drive it rather than a mount-time snapshot.
	import type { InlineWidgetComponentProps } from '$lib/core/inline/inline-widgets';

	let { getPresentationMode, getTheme }: InlineWidgetComponentProps = $props();

	// 'absent' rather than the production defaults: an unthreaded getter must read as a
	// missing channel, not as a plausible value.
	const mode = $derived(getPresentationMode?.() ?? 'absent');
	const theme = $derived(getTheme?.() ?? 'absent');
</script>

<span class="mode-reading-widget">{mode}/{theme}</span>
