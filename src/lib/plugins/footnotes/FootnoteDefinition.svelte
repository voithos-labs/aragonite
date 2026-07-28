<script lang="ts">
	// The footnote definition on `createContainerBlock` — the same public seam the
	// blockquote and details containers use. Its one addition is the ambient prefix:
	// the `[^label]: ` marker is contributed to the first child as a dimmed, read-only
	// prefix (the listItem `- ` model), so the definition's body edits like ordinary
	// prose while its marker stays source-faithful chrome.
	import {
		BlockList,
		createContainerBlock,
		getPluginMetadata,
		type ContainerBlockComponent,
		type NodeView
	} from '$lib/plugin';
	import type { FootnoteDefMetadata } from './footnote-definition';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	let boxEl: HTMLElement | undefined = $state();

	const label = $derived(getPluginMetadata<FootnoteDefMetadata>(node)?.label ?? '');

	const { blockListProps, containerApi } = createContainerBlock({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getBoxEl: () => boxEl,
		getAmbientPrefix: () => `[^${label}]: `
	});

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

	// Completeness guard: `bind:this` reads each export individually, so a new
	// ContainerBlockComponent member left un-forwarded above fails `npm run check` here.
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

<div class="footnote-def" data-footnote-label={label} bind:this={boxEl}>
	<BlockList {...blockListProps} />
</div>

<style>
	/* The ambient `[^label]: ` marker is the child leaf's own dimmed prefix span; the
	   block adds a restrained gutter rail so a definition reads as a distinct footnote
	   region without card chrome. */
	.footnote-def {
		position: relative;
		margin: 0.4em 0;
		padding-left: 0.9em;
		border-left: 2px solid var(--color-border, #3d4047);
		font-size: 0.95em;
	}
</style>
