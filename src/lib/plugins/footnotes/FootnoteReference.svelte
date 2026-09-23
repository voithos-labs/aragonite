<script lang="ts">
	import { isWidgetActivationClick, type InlineWidgetComponentProps } from '$lib/plugin';
	import { assignFootnoteNumbers, footnoteNumbersFor } from './footnote-numbering';
	import { findFootnoteDefinitionLanding } from './footnote-lookup';
	import { footnoteReferenceLabel } from './constants';

	let {
		source,
		getDocument,
		getContentVersion,
		getPresentationMode,
		navigateTo
	}: InlineWidgetComponentProps = $props();

	// Read once: the widget remounts on any source change, so this can never go stale.
	// svelte-ignore state_referenced_locally
	const label = source.slice(2, -1);

	// Reactive, not computed once: widgets are keyed on the source, so this instance survives a
	// renumber caused by a reference added elsewhere. The version is read inside the derived, so
	// the shared numbering pass stays subscribed rather than snapshotted.
	const display = $derived.by(() => {
		const doc = getDocument?.();
		if (!doc) return label;
		const version = getContentVersion?.();
		const numbers =
			version === undefined ? assignFootnoteNumbers(doc) : footnoteNumbersFor(doc, version);
		return String(numbers.get(label) ?? label);
	});

	// A tab stop only in reading mode: inside an editable block it would interrupt the caret.
	const isReading = $derived((getPresentationMode?.() ?? 'source') === 'reading');

	// Looked up on each jump, never derived: a reference nobody follows costs nothing beyond the
	// numbering pass it already pays for.
	function jumpToDefinition(): void {
		const doc = getDocument?.();
		if (!doc) return;
		const path = findFootnoteDefinitionLanding(doc, label);
		if (path) void navigateTo?.(path);
	}

	function onClick(e: MouseEvent): void {
		const mode = getPresentationMode?.() ?? 'source';
		if (isWidgetActivationClick(e.ctrlKey || e.metaKey, mode)) jumpToDefinition();
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
