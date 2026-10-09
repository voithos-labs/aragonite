<script lang="ts">
	import type { InlineWidgetComponentProps } from '#lib/plugin.js';
	import { footnoteNumbersFor } from './footnote-numbering';
	import { findFootnoteDefinitionLanding } from './footnote-lookup';
	import { footnoteReferenceLabel } from './constants';

	let {
		source,
		getDocument,
		getContentVersion,
		getPresentationMode,
		navigateTo,
		computeInlineContent,
		isActivationClick
	}: InlineWidgetComponentProps = $props();

	// Read once: the widget remounts on any source change, so this can never go stale.
	// svelte-ignore state_referenced_locally
	const label = source.slice(2, -1);

	// Reactive, since a widget keyed on its source survives a renumber from a reference added
	// elsewhere; reading the version inside keeps the shared numbering pass subscribed.
	const display = $derived.by(() => {
		const doc = getDocument();
		if (!doc) return label;
		const numbers = footnoteNumbersFor(doc, getContentVersion(), computeInlineContent);
		return String(numbers.get(label) ?? label);
	});

	// A tab stop only in reading mode: inside an editable block it would interrupt the caret.
	const isReading = $derived(getPresentationMode() === 'reading');

	// Looked up on each jump, never derived: a reference nobody follows costs nothing beyond the
	// numbering pass it already pays for.
	function jumpToDefinition(): void {
		const doc = getDocument();
		if (!doc) return;
		const path = findFootnoteDefinitionLanding(doc, label);
		if (path) void navigateTo(path);
	}

	function onClick(e: MouseEvent): void {
		if (isActivationClick(e.ctrlKey || e.metaKey)) jumpToDefinition();
	}

	function onKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			e.stopPropagation();
			jumpToDefinition();
		}
	}
</script>

<!-- The superscript stays a `<sup>` for its layout; the role says what it does. -->
<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<sup
	class="footnote-ref"
	role="link"
	aria-label={footnoteReferenceLabel(display)}
	tabindex={isReading ? 0 : undefined}
	onclick={onClick}
	onkeydown={onKeydown}>{display}</sup
>

<style>
	.footnote-ref {
		color: var(--color-accent, #567b67);
		cursor: pointer;
	}
</style>
