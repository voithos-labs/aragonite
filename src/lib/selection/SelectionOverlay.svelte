<!--
	Cross-block selection overlay rendered inside a BlockHost wrapper.
	Decides whether the current block is outside the selection, an
	endpoint (start/end), or an entirely-covered middle block, and paints
	the matching visual:

	- middle: a single full-bleed rectangle filling the wrapper
	- start / end: one rectangle per DOMRect reported by the block's
	  measurePartialRects?, translated into wrapper-local coordinates
	- outside / single-block: nothing (native selection handles single-block)

	Positioning is absolute, and all overlay nodes carry contenteditable="false"
	so they never interfere with text editing inside the underlying block.
-->
<script lang="ts">
	import { getContext } from 'svelte';
	import { SELECTION_KEY, type BlockComponent } from '../editor-types';
	import type { SelectionState } from './selection-state.svelte';
	import { normalize } from './selection-point';
	import { classifyBlockForSelection, type BlockSelectionClass } from './overlay-measure';

	let {
		path,
		blockRef,
		blockEl,
		isContainer = false
	}: {
		path: number[];
		/** Ref to the block component, used for partial-rect measurement. */
		blockRef: BlockComponent | undefined;
		/** The block's DOM element, used to translate viewport rects to wrapper-local. */
		blockEl: HTMLElement | null | undefined;
		/** Container blocks (blockquote, list, listItem) skip overlays — children handle it. */
		isContainer?: boolean;
	} = $props();

	const selection = getContext<SelectionState>(SELECTION_KEY);

	const classification = $derived.by<BlockSelectionClass>(() => {
		if (isContainer) return 'outside';
		if (!selection?.isCrossBlock || !selection.anchor || !selection.focus) {
			return 'outside';
		}
		return classifyBlockForSelection(path, {
			anchor: selection.anchor,
			focus: selection.focus
		});
	});

	interface LocalRect {
		left: number;
		top: number;
		width: number;
		height: number;
	}

	let endpointRects: LocalRect[] = $state([]);

	$effect(() => {
		if (classification !== 'start' && classification !== 'end') {
			endpointRects = [];
			return;
		}
		if (!blockRef?.measurePartialRects || !blockEl || !selection?.anchor || !selection?.focus) {
			endpointRects = [];
			return;
		}

		const { start, end } = normalize({ anchor: selection.anchor, focus: selection.focus });

		// Start blocks run from the selection's start offset to the end of
		// their content; end blocks run from 0 to the selection's end offset.
		// MAX_SAFE_INTEGER leans on createRangeFromOffsets' clamping behavior.
		const startOffset = classification === 'start' ? start.offset : 0;
		const endOffset = classification === 'start' ? Number.MAX_SAFE_INTEGER : end.offset;

		const viewportRects: DOMRect[] = blockRef.measurePartialRects(startOffset, endOffset);
		const blockRect = blockEl.getBoundingClientRect();
		endpointRects = viewportRects.map((r) => ({
			left: r.left - blockRect.left,
			top: r.top - blockRect.top,
			width: r.width,
			height: r.height
		}));
	});
</script>

{#if classification === 'middle'}
	<div class="selection-overlay selection-overlay-middle" contenteditable="false"></div>
{:else if classification === 'start' || classification === 'end'}
	{#each endpointRects as rect}
		<div
			class="selection-overlay selection-overlay-endpoint"
			contenteditable="false"
			style="left: {rect.left}px; top: {rect.top}px; width: {rect.width}px; height: {rect.height}px;"
		></div>
	{/each}
{/if}

<style>
	.selection-overlay {
		position: absolute;
		pointer-events: none;
		background-color: var(--selection-overlay-bg, rgba(100, 150, 255, 0.3));
		z-index: 1;
	}
	.selection-overlay-middle {
		inset: 0;
	}
</style>
