<script lang="ts">
	// A section's drawing: the toggle beside its summary and the children under it. The editor folds
	// the body, keeps the fold in reading mode without writing, and puts a caret in the body on the
	// summary when the section closes.
	import type { ContainerDrawContext } from '@voithos-labs/aragonite/plugin';
	import type { SvelteBlockProps } from '@voithos-labs/aragonite/svelte';
	import type { DetailsData } from './details-plugin';

	let { ctx, Slot }: SvelteBlockProps<DetailsData, ContainerDrawContext> = $props();
</script>

<div class="details-block">
	<button
		type="button"
		class="details-toggle"
		contenteditable="false"
		aria-expanded={!ctx.closed}
		aria-label="Toggle details"
		onmousedown={(e) => e.preventDefault()}
		onclick={() => ctx.setClosed(!ctx.closed)}
	></button>
	<Slot of="children" />
</div>

<style>
	/* Matches the admonition's left border and text column so the two look like a family. */
	.details-block {
		position: relative;
		margin: 0.8em 0;
		padding: 0.15em 0 0.15em 1.7em;
		border-left: 3px solid var(--color-border);
	}

	.details-toggle {
		position: absolute;
		left: 0.45em;
		/* Ties the button's em sizes to the editor font; without it the browser's default
		   font-size shrinks the line box below and floats the arrow above the summary title. */
		font: inherit;
		/* Sits exactly over the summary's first line (the block's padding plus the child's
		   2px, one line-height tall), so centring lands the arrow on the title line. */
		top: calc(0.15em + 2px);
		width: 1.1em;
		height: 1.6em;
		display: flex;
		align-items: center;
		padding: 0;
		border: none;
		background: transparent;
		cursor: pointer;
		color: var(--color-text-muted);
	}
	.details-toggle::before {
		content: '';
		display: block;
		width: 0;
		height: 0;
		margin-left: 0.25em;
		border-left: 6px solid currentColor;
		border-top: 4px solid transparent;
		border-bottom: 4px solid transparent;
		transition: transform 0.1s ease;
	}
	.details-toggle[aria-expanded='true']::before {
		transform: rotate(90deg);
	}
	.details-toggle:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
		border-radius: var(--radius-ui, 3px);
	}

	/* The summary is styled as a title row by CSS alone; it stays a real block among the children,
	   so selection and windowing treat it as an ordinary child. */
	.details-block :global(.details-summary) {
		font-weight: 600;
	}
	.details-block :global(.details-summary:empty)::before {
		content: 'Summary';
		color: var(--color-ui-dulled);
		pointer-events: none;
	}
</style>
