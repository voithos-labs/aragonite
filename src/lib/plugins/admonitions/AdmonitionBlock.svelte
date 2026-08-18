<!--
  One alert box for both admonition kinds: the directive admonition (editable title
  chrome leaf at child 0) and the GitHub alert (no title, a static badge instead).
  createContainerBlock hides all child-list state, so this owns only its chrome;
  node/index/path go in as thunks so each is re-read live, never snapshotted.
-->
<script lang="ts">
	import { BlockList, createContainerBlock, getPluginMetadata, type NodeView } from '$lib/plugin';
	import {
		capitalize,
		coerceAdmonitionName,
		GITHUB_ALERT,
		type AdmonitionMetadata,
		type GithubAlertMetadata
	} from './kinds';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();
	let boxEl: HTMLElement | undefined = $state();

	const { blockListProps, containerApi, handleKeydown } = createContainerBlock({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getBoxEl: () => boxEl
	});

	const isAlert = $derived(node.kind === GITHUB_ALERT);
	const kind = $derived(
		isAlert
			? coerceAdmonitionName(getPluginMetadata<GithubAlertMetadata>(node)?.alertType?.toLowerCase())
			: coerceAdmonitionName(getPluginMetadata<AdmonitionMetadata>(node)?.name)
	);
	const titleEmpty = $derived(isAlert || (node.children?.[0]?.raw ?? '').trim() === '');

	export { containerApi };
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="admonition"
	data-kind={kind}
	data-title-empty={titleEmpty}
	data-alert-source={isAlert ? 'github' : 'directive'}
	aria-label={`${capitalize(kind)} ${isAlert ? 'alert' : 'admonition'}`}
	bind:this={boxEl}
	onkeydown={handleKeydown}
>
	{#if isAlert}
		<!-- Static badge: contenteditable=false keeps the caret in the body, where the
		     alert's real content lives. -->
		<div class="admonition-title" contenteditable="false" aria-hidden="true"></div>
	{/if}
	<BlockList {...blockListProps} />
</div>

<style>
	/* A gutter rail, not a card: a document, not a boxed callout. */
	.admonition {
		position: relative;
		margin: 0.8em 0;
		padding: 0.15em 0 0.15em 1em;
		border-left: 3px solid var(--adm-accent);
	}

	/* One block per kind carries the whole axis: accent, icon glyph, untitled label. Fixed hex,
	   not theme tokens: GitHub's alert palette is canonically one color per kind, so admonitions
	   read identically across host themes. */
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

	/* Positioned so the icon and untitled-name pseudo-elements anchor to the row. */
	.admonition :global(.admonition-title) {
		position: relative;
		font-weight: 600;
		color: var(--adm-accent);
		padding-left: 1.7em;
		min-height: 1.4em;
		line-height: 1.4em;
	}

	/* The alert badge is static chrome, never a caret target. */
	.admonition[data-alert-source='github'] :global(.admonition-title) {
		user-select: none;
		cursor: default;
	}

	/* Masked, not colored, so one glyph recolors per kind. */
	.admonition :global(.admonition-title)::before {
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

	/* The empty title leaf holds a lone <br>, which pre-wrap paints as a trailing empty
	   line; capping to one row keeps the title-to-body gap equal to the titled variants. */
	.admonition[data-title-empty='true'] :global(.admonition-title) {
		height: 1.4em;
	}

	/* Absolute, not inline: the empty leaf's <br> would wrap generated content onto a
	   second row and break titled/untitled geometry parity. */
	.admonition[data-title-empty='true'] :global(.admonition-title)::after {
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
