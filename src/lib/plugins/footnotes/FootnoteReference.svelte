<script lang="ts">
	import { isWidgetActivationClick, type InlineWidgetComponentProps } from '$lib/plugin';
	import { assignFootnoteNumbers, footnoteNumbersFor } from './footnote-numbering';
	import { findFootnoteDefinitionLanding } from './footnote-lookup';

	let {
		source,
		getDocument,
		getContentVersion,
		getPresentationMode,
		navigateTo
	}: InlineWidgetComponentProps = $props();

	// Frozen: the pool remounts on any source change, so this can never go stale.
	// svelte-ignore state_referenced_locally
	const label = source.slice(2, -1);

	// Reactive, not baked: the pool keys on the source, so this instance survives a renumber
	// driven by a reference added elsewhere. The version is read inside the derived, so the
	// shared walk stays subscribed rather than snapshotted.
	const display = $derived.by(() => {
		const doc = getDocument?.();
		if (!doc) return label;
		const version = getContentVersion?.();
		const numbers =
			version === undefined ? assignFootnoteNumbers(doc) : footnoteNumbersFor(doc, version);
		return String(numbers.get(label) ?? label);
	});

	// Resolved on the gesture, never derived: a reference that is never clicked costs nothing
	// beyond the numbering walk it already pays for.
	function onClick(e: MouseEvent): void {
		const mode = getPresentationMode?.() ?? 'source';
		if (!isWidgetActivationClick(e.ctrlKey || e.metaKey, mode)) return;
		const doc = getDocument?.();
		if (!doc) return;
		const path = findFootnoteDefinitionLanding(doc, label);
		if (path) void navigateTo?.(path);
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<sup class="footnote-ref" onclick={onClick}>{display}</sup>

<style>
	.footnote-ref {
		color: var(--color-accent, #567b67);
		cursor: pointer;
	}
</style>
