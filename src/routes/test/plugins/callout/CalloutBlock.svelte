<script lang="ts">
	// A plugin container built entirely on the public `aragonite/plugin` seam:
	// `createContainerBlock` hides every editor internal the built-in blockquote
	// reaches for (block-list state, the ancestor contexts, container-exit,
	// windowing, the BlockComponent shim). This component supplies only its own
	// chrome around the returned BlockList props.
	import {
		BlockList,
		createContainerBlock,
		type ContainerBlockComponent,
		type NodeView
	} from '$lib/plugin';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="callout-block" bind:this={boxEl} onkeydown={handleKeydown}>
	<BlockList {...blockListProps} />
</div>

<style>
	/* Chrome is the only divergence from the built-in blockquote. The icon is a
	   positioned pseudo-element rather than a real element — a style choice, not a
	   requirement: the `:scope > .block-list` windowing lookup only needs BlockList
	   to stay a DIRECT child, not the sole one (DetailsBlock puts a real button
	   sibling beside it). */
	.callout-block {
		position: relative;
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: 6px;
		background: color-mix(in srgb, var(--color-ui-muted, #a4a4a4) 8%, transparent);
		padding: 8px 12px 8px 34px;
		margin: 6px 0;
	}
	.callout-block::before {
		content: 'ℹ';
		position: absolute;
		left: 10px;
		top: 8px;
		font-size: 14px;
		line-height: 1.4;
		color: var(--color-text-muted, #aaaaaa);
	}

	/* Reserved child-0 chrome: the `note-title` leaf, CSS-promoted to a title row
	   above the body. It stays a real block inside the sole `.block-list`, so
	   selection/windowing treat it as an ordinary child. */
	.callout-block :global(.note-title) {
		font-weight: 600;
		border-bottom: 1px solid var(--color-ui-muted, #a4a4a4);
		margin-bottom: 4px;
		padding-bottom: 4px;
	}
	.callout-block :global(.note-title:empty)::before {
		content: 'Title';
		color: var(--color-ui-dulled, #afb1b3);
		pointer-events: none;
	}
</style>
