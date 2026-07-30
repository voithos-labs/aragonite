<script lang="ts">
	// DEV-guard probe: a createContainerBlock whose explicit `isCollapsed` dep
	// disagrees with the descriptor (which declares no reservedChrome.isCollapsed
	// probe), tripping composeCollapseProbe's dev-warn at render. Proves a plugin
	// author's own `vite dev` still receives the packaged editor's guard signal.
	import { BlockList, createContainerBlock, type NodeView } from 'aragonite/plugin';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	let boxEl: HTMLElement | undefined = $state();

	const { blockListProps, containerApi } = createContainerBlock({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getBoxEl: () => boxEl,
		// The devprobe descriptor declares no collapse probe, so
		// isCollapsedContainer(node) is false; this `true` is the deliberate
		// disagreement that dev-warns.
		isCollapsed: () => true
	});

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
</script>

<div class="devprobe-block" bind:this={boxEl}>
	<BlockList {...blockListProps} />
</div>
