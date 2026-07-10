<!--
  Renders an admonition: a kind-colored box whose first line is the editable
  title chrome leaf (child 0) and whose body is the nested BlockList. All child-
  list state, ancestor wiring, and windowing are hidden by createContainerBlock;
  this component owns only its chrome. Reactive node/index/path are read through
  getters so a parent op or undo replacement is observed, never snapshotted.
-->
<script lang="ts">
	import {
		BlockList,
		createContainerBlock,
		getPluginMetadata,
		trimTrailingLineEnding,
		type CstNode
	} from '$lib/plugin';
	import { ADMONITION_KINDS, capitalize, type AdmonitionMetadata } from './kinds';

	let { node, index, myPath = [] }: { node: CstNode; index: number; myPath?: number[] } = $props();
	let boxEl: HTMLElement | undefined = $state();

	const { blockListProps, containerApi, handleKeydown } = createContainerBlock({
		get node() {
			return node;
		},
		get index() {
			return index;
		},
		get path() {
			return myPath;
		},
		getBoxEl: () => boxEl
	});

	const name = $derived(getPluginMetadata<AdmonitionMetadata>(node)?.name ?? ADMONITION_KINDS[0]);
	const kind = $derived(
		(ADMONITION_KINDS as readonly string[]).includes(name) ? name : ADMONITION_KINDS[0]
	);
	const titleEmpty = $derived(trimTrailingLineEnding(node.children?.[0]?.raw ?? '').trim() === '');

	export const editable = containerApi.editable;
	export const focusable = containerApi.focusable;
	export const focus = containerApi.focus;
	export const getCursorOffset = containerApi.getCursorOffset;
	export const getCursorPosition = containerApi.getCursorPosition;
	export const focusByPath = containerApi.focusByPath;
	export const focusAtColumn = containerApi.focusAtColumn;
	export const isVerticallyTransparent = containerApi.isVerticallyTransparent;
	export const selectEdgeWidget = containerApi.selectEdgeWidget;
	export const getBlockComponentByPath = containerApi.getBlockComponentByPath;
	export const revealByPath = containerApi.revealByPath;
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="admonition"
	data-kind={kind}
	data-title-empty={titleEmpty}
	aria-label={`${capitalize(kind)} admonition`}
	bind:this={boxEl}
	onkeydown={handleKeydown}
>
	<BlockList {...blockListProps} />
</div>

<style>
	.admonition {
		--adm-accent: var(--adm-note);
		/* Fixed hex per kind, not theme tokens: GitHub's alert palette is canonically
		   one fixed color per kind, so admonitions read identically across host themes. */
		--adm-note: #1f6feb;
		--adm-tip: #2da44e;
		--adm-important: #8250df;
		--adm-warning: #d29922;
		--adm-caution: #e5534b;

		position: relative;
		margin: 0.6em 0;
		border: 1px solid color-mix(in srgb, var(--adm-accent) 40%, transparent);
		border-left: 3px solid var(--adm-accent);
		border-radius: 6px;
		background: color-mix(in srgb, var(--adm-accent) 7%, transparent);
		padding: 0.35em 0.85em 0.55em;
	}

	.admonition[data-kind='note'] {
		--adm-accent: var(--adm-note);
	}
	.admonition[data-kind='tip'] {
		--adm-accent: var(--adm-tip);
	}
	.admonition[data-kind='important'] {
		--adm-accent: var(--adm-important);
	}
	.admonition[data-kind='warning'] {
		--adm-accent: var(--adm-warning);
	}
	.admonition[data-kind='caution'] {
		--adm-accent: var(--adm-caution);
	}

	/* The title chrome leaf (child 0) is the header row. */
	.admonition :global(.admonition-title) {
		font-weight: 600;
		color: var(--adm-accent);
		padding-left: 2.1em;
		min-height: 1.4em;
		line-height: 1.4em;
	}

	/* Kind icon, tinted to the accent via a mask so one glyph recolors per kind. */
	.admonition :global(.admonition-title)::before {
		content: '';
		position: absolute;
		left: 0.7em;
		width: 1.1em;
		height: 1.4em;
		background-color: var(--adm-accent);
		-webkit-mask: var(--adm-icon) center / 1.1em no-repeat;
		mask: var(--adm-icon) center / 1.1em no-repeat;
		pointer-events: none;
		user-select: none;
	}

	.admonition[data-kind='note'] {
		--adm-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm.9 3.3a.9.9 0 1 1-1.8 0 .9.9 0 0 1 1.8 0zM7.1 7h1.8v5.2H7.1z'/%3E%3C/svg%3E");
	}
	.admonition[data-kind='tip'] {
		--adm-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 1a4.5 4.5 0 0 0-2.7 8.1c.4.3.7.8.7 1.3v.6h4v-.6c0-.5.3-1 .7-1.3A4.5 4.5 0 0 0 8 1zM6 12.5h4v.8H6zm.5 1.7h3l-.6.6a1 1 0 0 1-.7.3h-.4a1 1 0 0 1-.7-.3z'/%3E%3C/svg%3E");
	}
	.admonition[data-kind='important'] {
		--adm-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M2.5 2h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6l-3 2.6V11H2.5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM7.1 4.2h1.8v3.6H7.1zm0 4.4h1.8v1.6H7.1z'/%3E%3C/svg%3E");
	}
	.admonition[data-kind='warning'] {
		--adm-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 1.3 15 14H1zM7.1 6h1.8v4H7.1zm0 5h1.8v1.6H7.1z'/%3E%3C/svg%3E");
	}
	.admonition[data-kind='caution'] {
		--adm-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M5 1.3h6l4 4v6l-4 4H5l-4-4V5.3zM7.1 4h1.8v5H7.1zm0 6h1.8v1.6H7.1z'/%3E%3C/svg%3E");
	}

	/* Untitled: show the capitalized kind name where the caret sits. */
	.admonition[data-title-empty='true'] :global(.admonition-title)::after {
		opacity: 0.72;
		font-weight: 600;
		pointer-events: none;
		user-select: none;
	}
	.admonition[data-kind='note'][data-title-empty='true'] :global(.admonition-title)::after {
		content: 'Note';
	}
	.admonition[data-kind='tip'][data-title-empty='true'] :global(.admonition-title)::after {
		content: 'Tip';
	}
	.admonition[data-kind='important'][data-title-empty='true'] :global(.admonition-title)::after {
		content: 'Important';
	}
	.admonition[data-kind='warning'][data-title-empty='true'] :global(.admonition-title)::after {
		content: 'Warning';
	}
	.admonition[data-kind='caution'][data-title-empty='true'] :global(.admonition-title)::after {
		content: 'Caution';
	}
</style>
