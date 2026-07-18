<script lang="ts">
	// The `<details>` collapsible on `createContainerBlock` — the same public seam
	// the callout uses, plus a disclosure toggle. Collapse-ness has ONE definition:
	// the descriptor's `reservedChrome.isCollapsed` probe. The factory derives its
	// window/focus clamp from that probe, so this component threads no collapse dep;
	// it reads `isCollapsedContainer` only for its own disclosure UI.
	import {
		BlockList,
		createContainerBlock,
		isCollapsedContainer,
		type ContainerBlockComponent,
		type NodeView
	} from '$lib/plugin';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	let boxEl: HTMLElement | undefined = $state();

	const open = $derived(!isCollapsedContainer(node));

	const { blockListProps, containerApi, updateOwnMetadata } = createContainerBlock({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getBoxEl: () => boxEl
	});

	function toggle() {
		// The disclosure commits an `open` metadata edit (the source bytes change),
		// so reading mode makes it inert like the task checkbox. A plugin component
		// reads the mode off the editor root — the documented DOM-tier pattern.
		if (boxEl?.closest('[data-presentation="reading"]')) return;
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
	/* Sibling of the admonition gutter-rail: a neutral hairline rail plus a
	   disclosure caret in the gutter — restrained, but clearly interactive. Mirrors
	   the admonition's rail gap and caret column so the two read as a family. */
	.details-block {
		position: relative;
		margin: 0.8em 0;
		padding: 0.15em 0 0.15em 1.7em;
		border-left: 3px solid var(--color-border, #3d4047);
	}

	/* The toggle is a real focusable button (keyboard disclosure), so unlike the
	   callout's pseudo-element icon it is a sibling of BlockList. That is fine:
	   the windowing lookup resolves `:scope > .block-list`, which tolerates a
	   sibling — it only needs BlockList to stay a DIRECT child, not the sole one. */
	.details-toggle {
		position: absolute;
		left: 0.45em;
		top: 2px;
		width: 1.1em;
		height: 1.4em;
		padding: 0;
		border: none;
		background: transparent;
		cursor: pointer;
		color: var(--color-text-muted, #aaaaaa);
	}
	.details-toggle::before {
		content: '';
		display: block;
		width: 0;
		height: 0;
		margin: 0.45em 0 0 0.25em;
		border-left: 6px solid currentColor;
		border-top: 4px solid transparent;
		border-bottom: 4px solid transparent;
		transition: transform 0.1s ease;
	}
	.details-toggle[aria-expanded='true']::before {
		transform: rotate(90deg);
	}
	.details-toggle:focus-visible {
		outline: 2px solid var(--color-accent, #567b67);
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
