<script lang="ts">
	// The marker rides the first child as an ambient prefix (the listItem `- ` model),
	// so the body edits like ordinary prose while the marker stays read-only chrome.
	import {
		BlockList,
		createContainerBlock,
		getPluginMetadata,
		type DocumentView,
		type EditorRects,
		type NodeView
	} from '$lib/plugin';
	import type { FootnoteDefMetadata } from './footnote-definition';
	import { collectFootnoteReferences } from './footnote-numbering';

	let {
		node,
		index,
		myPath = [],
		document,
		rects
	}: {
		node: NodeView;
		index: number;
		myPath?: number[];
		document?: DocumentView;
		rects?: EditorRects;
	} = $props();

	let boxEl: HTMLElement | undefined = $state();

	const label = $derived(getPluginMetadata<FootnoteDefMetadata>(node)?.label ?? '');

	// GFM numbers by first-reference order, so the first reference is the one this
	// definition's number was minted from. Read through the prop, which subscribes the
	// walk to edits anywhere, so a reference added elsewhere re-derives it.
	const firstReferencePath = $derived(
		document
			? (collectFootnoteReferences(document).find((ref) => ref.label === label)?.path ?? null)
			: null
	);

	const { blockListProps, containerApi } = createContainerBlock({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getBoxEl: () => boxEl,
		getAmbientPrefix: () => `[^${label}]: `
	});

	export { containerApi };
</script>

<div class="footnote-def" data-footnote-label={label} bind:this={boxEl}>
	<BlockList {...blockListProps} />
	{#if firstReferencePath}
		<button
			type="button"
			class="footnote-backref"
			contenteditable="false"
			aria-label="Back to reference"
			onmousedown={(e) => e.preventDefault()}
			onclick={() => void rects?.navigateTo(firstReferencePath)}
		></button>
	{/if}
</div>

<style>
	/* A gutter rail, not card chrome: the marker itself is the child leaf's prefix span. */
	.footnote-def {
		position: relative;
		margin: 0.4em 0;
		padding-left: 0.9em;
		border-left: 2px solid var(--color-border, #3d4047);
		font-size: 0.95em;
	}

	/* The body's blocks end their own line, so the `↩` sits under the note; the indent is
	   what keeps it reading as part of the note rather than chrome bolted to the box. */
	.footnote-backref {
		margin-left: 0.4em;
		padding: 0;
		border: none;
		background: none;
		font: inherit;
		line-height: 1;
		color: var(--color-accent, #567b67);
		cursor: pointer;
	}

	/* Painted, not written: DOM text here would count as content to every walk that reads
	   the container element. The aria-label carries the name. */
	.footnote-backref::before {
		content: '↩';
	}

	.footnote-backref:focus-visible {
		outline: 2px solid var(--color-accent, #567b67);
		outline-offset: 1px;
		border-radius: var(--radius-ui, 3px);
	}
</style>
