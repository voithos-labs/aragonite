<script lang="ts">
	import type { InlineWidgetComponentProps } from '$lib/plugin';
	import { assignFootnoteNumbers, footnoteNumbersFor } from './footnote-numbering';

	let { source, getDocument, getContentVersion }: InlineWidgetComponentProps = $props();

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
</script>

<sup class="footnote-ref">{display}</sup>

<style>
	.footnote-ref {
		color: var(--color-accent, #567b67);
		cursor: pointer;
	}
</style>
