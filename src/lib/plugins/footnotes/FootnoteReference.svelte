<script lang="ts">
	import type { InlineWidgetComponentProps } from '$lib/plugin';
	import { assignFootnoteNumbers } from './footnote-numbering';

	let { source, getDocument }: InlineWidgetComponentProps = $props();

	// Frozen: the pool remounts on any source change, so slicing `[^label]` down to
	// its label once can never go stale under the instance.
	// svelte-ignore state_referenced_locally
	const label = source.slice(2, -1);

	// Reactive, not baked. The pool keys on `${kind} ${source}`, so this instance
	// survives a renumber (an earlier reference added elsewhere shifts the number
	// while the source is unchanged) — a mount-time snapshot would go stale. Walking
	// the live document through assignFootnoteNumbers reads each prose leaf's raw,
	// which subscribes the derived to edits anywhere. Absent document (a bare harness
	// mount) falls back to the label.
	const display = $derived.by(() => {
		const doc = getDocument?.();
		if (!doc) return label;
		return String(assignFootnoteNumbers(doc).get(label) ?? label);
	});
</script>

<sup class="footnote-ref">{display}</sup>

<style>
	.footnote-ref {
		color: var(--color-accent, #567b67);
		cursor: pointer;
	}
</style>
