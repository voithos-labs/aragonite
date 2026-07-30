<!--
  Renders an alert box for both admonition kinds: the `:::name` directive admonition
  (its first line the editable title chrome leaf, child 0) and the native GitHub
  alert (`> [!TYPE]`, no title — a static badge stands in). The body is the nested
  BlockList; all child-list state, ancestor wiring, and windowing are hidden by
  createContainerBlock, so this component owns only its chrome. node/index/path are
  passed as thunks so each is re-read live — a parent op or undo replacement is
  observed, never snapshotted.
-->
<script lang="ts">
	import {
		BlockList,
		createContainerBlock,
		getPluginMetadata,
		type ContainerBlockComponent,
		type NodeView
	} from '$lib/plugin';
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

	// A GitHub alert has no editable title; the type comes from its own metadata and
	// its badge always shows the kind name (like an untitled directive admonition).
	const isAlert = $derived(node.kind === GITHUB_ALERT);
	const kind = $derived(
		isAlert
			? coerceAdmonitionName(getPluginMetadata<GithubAlertMetadata>(node)?.alertType?.toLowerCase())
			: coerceAdmonitionName(getPluginMetadata<AdmonitionMetadata>(node)?.name)
	);
	const titleEmpty = $derived(isAlert || (node.children?.[0]?.raw ?? '').trim() === '');

	export const editable = containerApi.editable;
	export const focusable = containerApi.focusable;
	export const focus = containerApi.focus;
	export const parkCaret = containerApi.parkCaret;
	export const getCursorOffset = containerApi.getCursorOffset;
	export const getCursorPosition = containerApi.getCursorPosition;
	export const focusByPath = containerApi.focusByPath;
	export const focusAtColumn = containerApi.focusAtColumn;
	export const isVerticallyTransparent = containerApi.isVerticallyTransparent;
	export const enterEdgeWidget = containerApi.enterEdgeWidget;
	export const getBlockComponentByPath = containerApi.getBlockComponentByPath;
	export const revealByPath = containerApi.revealByPath;

	// Completeness guard: `bind:this` reads each instance export individually, so the
	// block above cannot be collapsed — but this `satisfies` fails `npm run check` if a
	// new ContainerBlockComponent member is added and left un-forwarded above.
	void ({
		editable,
		focusable,
		focus,
		parkCaret,
		getCursorOffset,
		getCursorPosition,
		focusByPath,
		focusAtColumn,
		isVerticallyTransparent,
		enterEdgeWidget,
		getBlockComponentByPath,
		revealByPath
	} satisfies ContainerBlockComponent);
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
		<!-- Static badge for the markerless alert: the empty title leaf's icon + kind
		     name are drawn by the shared chrome CSS; contenteditable=false keeps the
		     caret in the body, where the alert's real content lives. -->
		<div class="admonition-title" contenteditable="false" aria-hidden="true"></div>
	{/if}
	<BlockList {...blockListProps} />
</div>

<style>
	/* Restrained gutter-rail, not a card: a kind-colored left rail and accent title
	   row, body text plain — a document, not a boxed callout. */
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
		margin: 0.8em 0;
		padding: 0.15em 0 0.15em 1em;
		border-left: 3px solid var(--adm-accent);
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

	/* The title chrome leaf (child 0) is the header row: icon + title on one line,
	   in the kind accent. Positioned so its pseudo-elements anchor to the row. */
	.admonition :global(.admonition-title) {
		position: relative;
		font-weight: 600;
		color: var(--adm-accent);
		padding-left: 1.7em;
		min-height: 1.4em;
		line-height: 1.4em;
	}

	/* The GitHub alert's badge is static chrome, not an editable title — never a
	   caret target. */
	.admonition[data-alert-source='github'] :global(.admonition-title) {
		user-select: none;
		cursor: default;
	}

	/* Kind icon, tinted to the accent via a mask so one glyph recolors per kind.
	   Sits in the gutter at the row's start; body text below aligns to this edge. */
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

	/* The empty title leaf holds a lone <br>; under pre-wrap that paints a trailing
	   empty line, so cap the untitled title to one row — otherwise the title-to-body
	   gap is a line taller than the titled variants. */
	.admonition[data-title-empty='true'] :global(.admonition-title) {
		height: 1.4em;
	}

	/* Untitled: show the capitalized kind name where the caret sits. Absolute like
	   the icon — the empty leaf holds a <br>, so inline generated content would wrap
	   onto a second row; pinning it to the row keeps titled/untitled geometry equal. */
	.admonition[data-title-empty='true'] :global(.admonition-title)::after {
		position: absolute;
		left: 1.7em;
		top: 2px;
		opacity: 0.72;
		font-weight: 600;
		line-height: 1.4em;
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
