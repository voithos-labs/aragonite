<script lang="ts">
	// Collapse-ness has one definition, the descriptor's `reservedChrome.isCollapsed`
	// probe. The reader's transient disclosure layers over it by feeding the factory
	// the effective state, so the window clamp, focus clamp and caret never disagree.
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
			// The effective state, so a transiently-opened section actually mounts and
			// measures its body.
			isCollapsed: () => !open
		});

	const reading = $derived(getPresentationMode() === 'reading');
	const reader = createReaderDisclosure({ isDocumentOpen: () => documentOpen });
	// Leaving reading mode discards the flip: with the bytes editable again, a view
	// state they disagree with would be a live lie.
	$effect(() => {
		if (!reading) reader.reset();
	});
	const open = $derived(reading ? reader.open : documentOpen);

	function commitDisclosure() {
		const isOpen = open;
		// Collapsing while the caret sits in a body child orphans it (the clamp unmounts
		// the body), so move it to the summary in the commit's afterTick. Read the caret
		// before the commit: the toggle suppresses mousedown, so a mouse toggle leaves it
		// in the body.
		const pos = isOpen ? (containerApi.getCursorPosition?.() ?? null) : null;
		const caretInBody = pos != null && pos.path[0] >= 1;
		updateOwnMetadata({ open: !isOpen }, caretInBody ? () => containerApi.focus(0) : undefined);
	}

	// Reading mode gets the handler that cannot write, not one that declines to: this
	// is the only mode read, and the toggle keeps working for a reader either way.
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
	/* Mirrors the admonition's rail gap and caret column so the two read as a family. */
	.details-block {
		position: relative;
		margin: 0.8em 0;
		padding: 0.15em 0 0.15em 1.7em;
		border-left: 3px solid var(--color-border, #3d4047);
	}

	/* A real focusable button (keyboard disclosure), so it is a sibling of BlockList.
	   Safe: the windowing lookup resolves `:scope > .block-list`, which only needs
	   BlockList to stay a direct child, not the sole one. */
	.details-toggle {
		position: absolute;
		left: 0.45em;
		/* Anchors the button's em geometry to the editor font; without it the UA font-size
		   shrinks the line-box math below and floats the caret above the summary title. */
		font: inherit;
		/* Overlays the summary's first line box exactly (block padding + the leaf's 2px,
		   one line-height tall), so flex-centering lands the caret on the title line. */
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

	/* The summary leaf is promoted to a title row by CSS alone; it stays a real block
	   inside `.block-list`, so selection and windowing treat it as an ordinary child. */
	.details-block :global(.details-summary) {
		font-weight: 600;
	}
	.details-block :global(.details-summary:empty)::before {
		content: 'Summary';
		color: var(--color-ui-dulled, #afb1b3);
		pointer-events: none;
	}
</style>
