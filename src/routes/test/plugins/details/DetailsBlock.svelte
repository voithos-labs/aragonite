<script lang="ts">
	// The `<details>` collapsible on `createContainerBlock` — the same public seam
	// the callout uses, plus a disclosure toggle and the collapse clamp.
	// Collapse-ness has ONE definition: the descriptor's `reservedChrome.isCollapsed`
	// probe, read here via `isCollapsedContainer` on the LIVE node so a toggle (or
	// its undo) re-renders the mounted body reactively.
	import { BlockList, createContainerBlock, isCollapsedContainer, type CstNode } from '$lib/plugin';

	let { node, index, myPath = [] }: { node: CstNode; index: number; myPath?: number[] } = $props();

	let boxEl: HTMLElement | undefined = $state();

	const open = $derived(!isCollapsedContainer(node));

	const { blockListProps, containerApi, updateOwnMetadata } = createContainerBlock({
		get node() {
			return node;
		},
		get index() {
			return index;
		},
		get path() {
			return myPath;
		},
		getBoxEl: () => boxEl,
		isCollapsed: () => isCollapsedContainer(node)
	});

	function toggle() {
		const isOpen = open;
		// Collapsing while the caret sits in a body child orphans it — the clamp
		// unmounts the body and kills the window pin — so move it to the summary in
		// the commit's afterTick. Read the caret BEFORE the commit; the toggle's
		// mousedown default is suppressed, so a mouse toggle leaves it in the body.
		const pos = isOpen ? (containerApi.getCursorPosition?.() ?? null) : null;
		const caretInBody = pos != null && pos.path[0] >= 1;
		updateOwnMetadata({ open: !isOpen }, caretInBody ? () => containerApi.focus(0) : undefined);
	}

	export const editable = containerApi.editable;
	export const focusable = containerApi.focusable;
	export const focus = containerApi.focus;
	export const getCursorOffset = containerApi.getCursorOffset;
	export const getCursorPosition = containerApi.getCursorPosition;
	export const focusByPath = containerApi.focusByPath;
	export const focusAtColumn = containerApi.focusAtColumn;
	export const isVerticallyTransparent = containerApi.isVerticallyTransparent!;
	export const selectEdgeWidget = containerApi.selectEdgeWidget!;
	export const getBlockComponentByPath = containerApi.getBlockComponentByPath!;
	export const revealByPath = containerApi.revealByPath!;
</script>

<div class="details-block" bind:this={boxEl}>
	<button
		type="button"
		class="details-toggle"
		contenteditable="false"
		aria-expanded={open}
		aria-label="Toggle details"
		onmousedown={(e) => e.preventDefault()}
		onclick={toggle}
	></button>
	<BlockList {...blockListProps} />
</div>

<style>
	/* The toggle is a real focusable button (keyboard disclosure), so unlike the
	   callout's pseudo-element icon it is a sibling of BlockList. That is fine:
	   the windowing lookup resolves `:scope > .block-list`, which tolerates a
	   sibling — it only needs BlockList to stay a DIRECT child, not the sole one. */
	.details-block {
		position: relative;
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: 6px;
		background: color-mix(in srgb, var(--color-ui-muted, #a4a4a4) 8%, transparent);
		padding: 8px 12px 8px 34px;
		margin: 6px 0;
	}
	.details-toggle {
		position: absolute;
		left: 8px;
		top: 8px;
		width: 18px;
		height: 18px;
		padding: 0;
		border: none;
		background: transparent;
		cursor: pointer;
		color: var(--color-text-secondary, #888);
	}
	.details-toggle::before {
		content: '';
		display: block;
		width: 0;
		height: 0;
		margin: 5px 0 0 5px;
		border-left: 6px solid currentColor;
		border-top: 4px solid transparent;
		border-bottom: 4px solid transparent;
		transition: transform 0.1s ease;
	}
	.details-toggle[aria-expanded='true']::before {
		transform: rotate(90deg);
	}
	.details-toggle:focus-visible {
		outline: 2px solid var(--color-accent, #4a7fff);
		outline-offset: 1px;
		border-radius: 3px;
	}

	/* Reserved child-0 chrome: the summary leaf, CSS-promoted to a bold title row.
	   It stays a real block inside the sole `.block-list`, so selection/windowing
	   treat it as an ordinary child. */
	.details-block :global(.details-summary) {
		font-weight: 600;
	}
	.details-block :global(.details-summary:empty)::before {
		content: 'Summary';
		color: var(--color-ui-dulled, #afb1b3);
		pointer-events: none;
	}
</style>
