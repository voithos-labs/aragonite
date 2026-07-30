<script lang="ts">
	// The `<details>` collapsible on `createContainerBlock` — the same public seam
	// the callout uses, plus a disclosure toggle. Collapse-ness has ONE definition:
	// the descriptor's `reservedChrome.isCollapsed` probe, read here through
	// `isCollapsedContainer`. The one thing layered over it is the reader's transient
	// disclosure, and it is layered by handing the factory the EFFECTIVE state as its
	// `isCollapsed` dep — so the window clamp, the focus clamp and the rendered caret
	// all see one answer rather than the view and the model disagreeing.
	import {
		BlockList,
		createContainerBlock,
		isCollapsedContainer,
		type NodeView
	} from '$lib/plugin';
	import { createReaderDisclosure } from './details-disclosure.svelte';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	let boxEl: HTMLElement | undefined = $state();

	const documentOpen = $derived(!isCollapsedContainer(node));

	const { blockListProps, containerApi, updateOwnMetadata, getPresentationMode } =
		createContainerBlock({
			getNode: () => node,
			getIndex: () => index,
			getPath: () => myPath,
			getBoxEl: () => boxEl,
			// The effective state, so a transiently-opened section actually MOUNTS and
			// measures its body. Nothing else needs teaching: every collapse consumer
			// reads the clamp the factory derives from this.
			isCollapsed: () => !open
		});

	const reading = $derived(getPresentationMode() === 'reading');
	const reader = createReaderDisclosure({ isDocumentOpen: () => documentOpen });
	// Leaving reading mode discards the reader's flip: outside that mode the bytes are
	// editable again, and a view state the bytes disagree with would be a live lie.
	$effect(() => {
		if (!reading) reader.reset();
	});
	const open = $derived(reading ? reader.open : documentOpen);

	/** Flip the document's own `open`, as one undoable metadata edit. */
	function commitDisclosure() {
		const isOpen = open;
		// Collapsing while the caret sits in a body child orphans it — the clamp
		// unmounts the body and kills the window pin — so move it to the summary in
		// the commit's afterTick. Read the caret BEFORE the commit; the toggle's
		// mousedown default is suppressed, so a mouse toggle leaves it in the body.
		const pos = isOpen ? (containerApi.getCursorPosition?.() ?? null) : null;
		const caretInBody = pos != null && pos.path[0] >= 1;
		updateOwnMetadata({ open: !isOpen }, caretInBody ? () => containerApi.focus(0) : undefined);
	}

	// Reading mode writes no bytes, so it gets the disclosure that CANNOT: the
	// reader's handler is closed over a module with no commit door in scope, rather
	// than over a commit it declines to call. One mode read, at the one site that
	// chooses — the toggle keeps working for a reader either way.
	const onToggle = $derived(reading ? reader.toggle : commitDisclosure);

	export { containerApi };
</script>

<div class="details-block" bind:this={boxEl}>
	<button
		type="button"
		class="details-toggle"
		contenteditable="false"
		aria-expanded={open}
		aria-label="Toggle details"
		onmousedown={(e) => e.preventDefault()}
		onclick={onToggle}
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
		/* `font: inherit` anchors this <button>'s em geometry to the editor font;
		   without it a button takes a smaller UA font-size, so the line-box math
		   below resolves too short and floats the caret above the summary title. */
		font: inherit;
		/* Overlay the summary's first line box exactly — the block's 0.15em top
		   padding plus the summary leaf's 2px, one line-height (1.6) tall — then
		   flex-center the caret so it lands on the title line by construction. */
		top: calc(0.15em + 2px);
		width: 1.1em;
		height: 1.6em;
		display: flex;
		align-items: center;
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
