<script lang="ts">
	// A reference drawn as its number: the order its label is first cited. In reading mode it is a
	// tab stop, and the editor follows it on Enter or Space, as on the click the host picked for links.
	import type { WidgetProps } from '@voithos-labs/aragonite/plugin';
	import { footnoteReferenceLabel } from './constants';
	import { numbersOf } from './numbering';

	let { data, depends, mode }: WidgetProps<string> = $props();

	const display = $derived(String(numbersOf(depends).get(data) ?? data));
</script>

<!-- The superscript stays a `<sup>` for its layout; the role says what it does. -->
<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<sup
	class="footnote-ref"
	role="link"
	aria-label={footnoteReferenceLabel(display)}
	tabindex={mode.editable ? undefined : 0}>{display}</sup
>

<style>
	.footnote-ref {
		color: var(--color-accent);
		cursor: pointer;
	}
</style>
