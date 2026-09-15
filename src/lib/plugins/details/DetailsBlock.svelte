<script lang="ts">
	// Whether a section is collapsed is decided in one place, `reservedChrome.isCollapsed` on
	// the kind descriptor. Reading mode's temporary open state goes into the factory on top of
	// it, so windowing, focus and the caret never disagree.
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
			// The state on screen, so a section opened only in reading mode still mounts
			// and measures its body.
			isCollapsed: () => !open
		});

	const reading = $derived(getPresentationMode() === 'reading');
	const reader = createReaderDisclosure({ isDocumentOpen: () => documentOpen });
	// Leaving reading mode discards the temporary state: with the bytes editable again, a
	// view that disagrees with them would be showing something the document does not say.
	$effect(() => {
		if (!reading) reader.reset();
	});
	const open = $derived(reading ? reader.open : documentOpen);

	function commitDisclosure() {
		const isOpen = open;
		// Collapsing unmounts the body, orphaning a caret inside it, so move it to the summary
		// in the commit's afterTick. Read before the commit: the toggle suppresses mousedown,
		// so a mouse toggle leaves the caret in the body.
		const pos = isOpen ? (containerApi.getCursorPosition?.() ?? null) : null;
		const caretInBody = pos != null && pos.path[0] >= 1;
		updateOwnMetadata({ open: !isOpen }, caretInBody ? () => containerApi.focus(0) : undefined);
	}

	// Reading mode gets the handler that cannot write at all, rather than one that checks the
	// mode and declines, so nothing reachable from here can turn a toggle into an edit.
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
	/* Matches the admonition's left border and text column so the two look like a family. */
	.details-block {
		position: relative;
		margin: 0.8em 0;
		padding: 0.15em 0 0.15em 1.7em;
		border-left: 3px solid var(--color-border, #3d4047);
	}

	/* A real focusable button (keyboard disclosure), so it is a sibling of BlockList: the
	   windowing lookup needs BlockList to stay a direct child, not the sole one. */
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
		border-radius: var(--radius-ui, 3px);
	}

	/* The summary is styled as a title row by CSS alone; it stays a real block inside
	   `.block-list`, so selection and windowing treat it as an ordinary child. */
	.details-block :global(.details-summary) {
		font-weight: 600;
	}
	.details-block :global(.details-summary:empty)::before {
		content: 'Summary';
		color: var(--color-ui-dulled, #afb1b3);
		pointer-events: none;
	}
</style>
