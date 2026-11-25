<!--
  One callout box for both types: a `:::note` box, whose opening line is its title row, and a GitHub
  alert, which has no title, a static badge instead.
-->
<script lang="ts">
	import { isBlankText, type ContainerDrawContext } from '@voithos-labs/aragonite/plugin';
	import type { SvelteBlockProps } from '@voithos-labs/aragonite/svelte';
	import { capitalize, coerceAdmonitionName, type AdmonitionData, type AlertData } from './kinds';

	let { block, Slot }: SvelteBlockProps<AdmonitionData | AlertData, ContainerDrawContext> =
		$props();

	const alertType = $derived('alertType' in block.data ? block.data.alertType : null);
	const kind = $derived(
		coerceAdmonitionName(alertType?.toLowerCase() ?? (block.data as AdmonitionData).name)
	);
	const titleEmpty = $derived(alertType !== null || isBlankText(block.title?.text ?? ''));
</script>

<div
	class="admonition"
	data-kind={kind}
	data-title-empty={titleEmpty}
	data-alert-source={alertType === null ? 'directive' : 'github'}
	aria-label={`${capitalize(kind)} ${alertType === null ? 'admonition' : 'alert'}`}
>
	{#if alertType !== null}
		<!-- Static badge: contenteditable=false keeps the caret in the body, where the
		     alert's real content lives. -->
		<div class="admonition-title" contenteditable="false" aria-hidden="true"></div>
	{/if}
	<Slot of="children" />
</div>

<style>
	/* A line down the left margin, not a card: this reads as a document, not a boxed callout. */
	.admonition {
		position: relative;
		margin: 0.8em 0;
		padding: 0.15em 0 0.15em 1em;
		border-left: 3px solid var(--adm-accent);
	}

	/* One block per kind sets what varies, in fixed hex after GitHub's one-color-per-kind alert
	   palette, so an admonition looks the same whatever theme the host uses. */
	.admonition[data-kind='note'] {
		--adm-accent: #1f6feb;
		--adm-label: 'Note';
		--adm-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm.9 3.3a.9.9 0 1 1-1.8 0 .9.9 0 0 1 1.8 0zM7.1 7h1.8v5.2H7.1z'/%3E%3C/svg%3E");
	}
	.admonition[data-kind='tip'] {
		--adm-accent: #2da44e;
		--adm-label: 'Tip';
		--adm-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 1a4.5 4.5 0 0 0-2.7 8.1c.4.3.7.8.7 1.3v.6h4v-.6c0-.5.3-1 .7-1.3A4.5 4.5 0 0 0 8 1zM6 12.5h4v.8H6zm.5 1.7h3l-.6.6a1 1 0 0 1-.7.3h-.4a1 1 0 0 1-.7-.3z'/%3E%3C/svg%3E");
	}
	.admonition[data-kind='important'] {
		--adm-accent: #8250df;
		--adm-label: 'Important';
		--adm-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M2.5 2h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6l-3 2.6V11H2.5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM7.1 4.2h1.8v3.6H7.1zm0 4.4h1.8v1.6H7.1z'/%3E%3C/svg%3E");
	}
	.admonition[data-kind='warning'] {
		--adm-accent: #d29922;
		--adm-label: 'Warning';
		--adm-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 1.3 15 14H1zM7.1 6h1.8v4H7.1zm0 5h1.8v1.6H7.1z'/%3E%3C/svg%3E");
	}
	.admonition[data-kind='caution'] {
		--adm-accent: #e5534b;
		--adm-label: 'Caution';
		--adm-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M5 1.3h6l4 4v6l-4 4H5l-4-4V5.3zM7.1 4h1.8v5H7.1zm0 6h1.8v1.6H7.1z'/%3E%3C/svg%3E");
	}

	/* The icon and the untitled name anchor to the row: the alert's badge, or this box's own opener
	   line, two elements down (the slot, the list's holder), never one nested deeper. */
	.admonition :global(.admonition-title),
	.admonition
		> :global(
			* > * > .block-list > [data-block-kind='directiveOpenerLine'] .directive-opener-line
		) {
		position: relative;
		font-weight: 600;
		color: var(--adm-accent);
		padding-left: 1.7em;
		min-height: 1.4em;
		line-height: 1.4em;
	}

	/* The alert badge is decoration, never a caret target. */
	.admonition[data-alert-source='github'] :global(.admonition-title) {
		user-select: none;
		cursor: default;
	}

	/* Masked, not colored, so one glyph recolors per kind. */
	.admonition :global(.admonition-title::before),
	.admonition
		> :global(
			* > * > .block-list > [data-block-kind='directiveOpenerLine'] .directive-opener-line::before
		) {
		content: '';
		position: absolute;
		left: 0;
		top: 2px;
		width: 1.1em;
		height: 1.4em;
		background-color: var(--adm-accent);
		-webkit-mask: var(--adm-icon) center / 1.1em no-repeat;
		mask: var(--adm-icon) center / 1.1em no-repeat;
		pointer-events: none;
		user-select: none;
	}

	/* An untitled opener line whose `:::name` is hidden paints nothing but a <br>, which pre-wrap
	   shows as a second line; capping to one row keeps the gap to the body the titled one's. */
	.admonition[data-title-empty='true'] :global(.admonition-title),
	.admonition[data-title-empty='true']
		> :global(
			* > * > .block-list > [data-block-kind='directiveOpenerLine'] .directive-opener-line
		) {
		height: 1.4em;
	}

	/* The kind's name stands in for a missing title wherever the line's `:::name` is hidden; absolute,
	   so the leaf's <br> can't wrap it onto a second row. */
	.admonition :global(.admonition-title::after),
	:global(.editor[data-presentation='reading'])
		.admonition[data-title-empty='true']
		> :global(
			* > * > .block-list > [data-block-kind='directiveOpenerLine'] .directive-opener-line::after
		),
	:global(.editor[data-presentation])
		.admonition[data-title-empty='true']
		> :global(
			*
				> *
				> .block-list
				> [data-block-kind='directiveOpenerLine']
				.directive-opener-line:not(:focus-within)::after
		) {
		content: var(--adm-label);
		position: absolute;
		left: 1.7em;
		top: 2px;
		opacity: 0.72;
		font-weight: 600;
		line-height: 1.4em;
		pointer-events: none;
		user-select: none;
	}
</style>
