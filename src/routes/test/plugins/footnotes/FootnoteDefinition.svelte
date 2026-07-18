<script lang="ts">
	import { getPluginMetadata, type DocumentView, type NodeView } from '$lib/plugin';
	import { assignFootnoteNumbers } from './footnote-numbering';
	import type { FootnoteDefMetadata } from './footnote-definition';

	let { node, document }: { node: NodeView; document?: DocumentView } = $props();

	// The closure declares focus not-supported (read-only opaque render), so the
	// component surface is inert: the members exist because BlockComponent requires
	// them, and they honestly answer "no caret here."
	export const editable = false;
	export const focusable = false;

	export function focus(_offset: number): void {}

	export function getCursorOffset(): number | null {
		return null;
	}

	const meta = $derived(getPluginMetadata<FootnoteDefMetadata>(node));
	const label = $derived(meta?.label ?? '');
	// The number is derived from the live document's reference order, so editing a
	// reference above renumbers every definition without a stored counter.
	const number = $derived(document ? (assignFootnoteNumbers(document).get(label) ?? null) : null);
	const body = $derived(bodyText(meta?.raw ?? ''));

	// Everything after the `[^label]:` marker, with the trailing newline dropped.
	function bodyText(raw: string): string {
		return raw
			.replace(/^ {0,3}\[\^[^\]\s]+\]:/, '')
			.replace(/\r?\n$/, '')
			.trim();
	}
</script>

<div class="footnote-def" data-footnote-label={label}>
	<span class="footnote-def-marker">{number ?? '—'}.</span>
	<span class="footnote-def-body">{body}</span>
</div>

<style>
	.footnote-def {
		display: flex;
		gap: 0.4em;
		font-size: 0.9em;
		color: var(--color-text-muted, #aaaaaa);
	}
	.footnote-def-marker {
		font-variant-numeric: tabular-nums;
		color: var(--color-accent, #6ea8fe);
	}
</style>
