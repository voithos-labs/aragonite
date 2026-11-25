<script lang="ts">
	// A definition's drawing: a rule down the left margin and its children. The editor draws the
	// `[^label]: ` marker in front of the first child, its `[^label]` a link back to the reference.
	import type { ContainerDrawContext } from '@voithos-labs/aragonite/plugin';
	import type { SvelteBlockProps } from '@voithos-labs/aragonite/svelte';
	import type { DefinitionData } from './footnotes-plugin';

	let { block, Slot }: SvelteBlockProps<DefinitionData, ContainerDrawContext> = $props();
</script>

<div class="footnote-def" data-footnote-label={block.data.label}>
	<Slot of="children" />
</div>

<style>
	/* A line down the left margin, not a card: the marker itself is drawn in front of the
	   first child. */
	.footnote-def {
		position: relative;
		margin: 0.4em 0;
		padding-left: 0.9em;
		border-left: 2px solid var(--color-border);
		font-size: 0.95em;
	}

	/* The marker span is built into the child block's DOM, outside this component's styles. */
	.footnote-def :global(.footnote-def-marker:hover) {
		text-decoration: underline;
	}

	/* Where a plain click follows the marker, a dotted underline tells it from the note's text
	   without relying on colour. */
	:global([data-plain-click-follows]) .footnote-def :global(.footnote-def-marker) {
		cursor: pointer;
		text-decoration: underline dotted;
	}
</style>
