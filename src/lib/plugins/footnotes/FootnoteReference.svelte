<script lang="ts">
	import type { InlineWidgetComponentProps } from '$lib/plugin';
	import { assignFootnoteNumbers, footnoteNumbersFor } from './footnote-numbering';

	let { source, getDocument, getContentVersion }: InlineWidgetComponentProps = $props();

	// Frozen: the pool remounts on any source change, so slicing `[^label]` down to
	// its label once can never go stale under the instance.
	// svelte-ignore state_referenced_locally
	const label = source.slice(2, -1);

	// Reactive, not baked. The pool keys on `${kind} ${source}`, so this instance
	// survives a renumber (an earlier reference added elsewhere shifts the number
	// while the source is unchanged) — a mount-time snapshot would go stale.
	//
	// Reading the content version INSIDE the derived is what keeps that reactivity
	// once the walk is shared: the version changes on every byte change, so this
	// widget re-derives on an edit anywhere, and the version is also the key that
	// keeps the walk itself to one per flush across every mounted reference. A bare
	// harness supplies neither getter: no document falls back to the label, no
	// version walks unshared (correct, just uncached).
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
