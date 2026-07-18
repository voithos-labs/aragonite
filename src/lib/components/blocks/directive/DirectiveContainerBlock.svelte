<script lang="ts">
	// The generic render surface for an unregistered `:::name` directive, built on
	// the public `createContainerBlock` seam (as CalloutBlock/DetailsBlock are). The
	// body is an ordinary nested BlockList; the only chrome is a dimmed, read-only
	// `:::name` marker over a thin gutter rail — a restrained cue, not a card box
	// (a document should feel like a document, not a pile of blocks).
	import {
		BlockList,
		createContainerBlock,
		getPluginMetadata,
		type ContainerBlockComponent
	} from '$lib/plugin';
	import type { NodeView } from '$lib/core/node-views';
	import type { DirectiveContainerMetadata } from '$lib/core/directive/kinds';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	let boxEl: HTMLElement | undefined = $state();

	const meta = $derived(getPluginMetadata<DirectiveContainerMetadata>(node));
	const marker = $derived(':'.repeat(meta?.colonCount ?? 3) + (meta?.name ?? ''));

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
	// Completeness guard: `bind:this` reads each instance export individually, so a
	// new ContainerBlockComponent member left un-forwarded above fails `npm run check`
	// here rather than surfacing as a runtime hole (MermaidBlock's pattern).
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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="directive-block" bind:this={boxEl} onkeydown={handleKeydown}>
	<span class="directive-marker" contenteditable="false">{marker}</span>
	<BlockList {...blockListProps} />
</div>

<style>
	.directive-block {
		border-left: 2px solid var(--color-ui-muted, #a4a4a4);
		padding-left: 0.75em;
		margin: 6px 0;
	}
	.directive-marker {
		display: block;
		font-family: var(--font-editor, ui-monospace, monospace);
		opacity: var(--syntax-marker-dim, 0.4);
		user-select: none;
		-webkit-user-select: none;
		cursor: default;
	}
</style>
