<script lang="ts">
	import { getContext } from 'svelte';
	import { SELECTION_KEY, SELECTION_END, type BlockComponent } from '../contracts';
	import type { SelectionState } from '../selection/selection-state.svelte';
	import {
		normalize,
		classifyBlockForSelection,
		type BlockSelectionClass
	} from '../selection/primitives';

	let {
		path,
		blockRef,
		blockEl,
		isContainer = false
	}: {
		path: number[];
		blockRef: BlockComponent | undefined;
		blockEl: HTMLElement | null | undefined;
		/** Container blocks skip overlays — their children paint their own. */
		isContainer?: boolean;
	} = $props();

	const selection = getContext<SelectionState>(SELECTION_KEY);

	// Containers that supply their own measurePartialRects (table) paint cell
	// rects from this overlay; their children don't render BlockHost wrappers.
	const containerPaintsRects = $derived(isContainer && !!blockRef?.measurePartialRects);

	const classification = $derived.by<BlockSelectionClass>(() => {
		if (isContainer && !containerPaintsRects) return 'outside';
		if (!selection?.isCustomRendered || !selection.anchor || !selection.focus) {
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

	/** Merge rects on the same visual line into a single rect to prevent double-highlight. */
	function mergeRectsPerLine(rects: LocalRect[]): LocalRect[] {
		if (rects.length <= 1) return rects;
		const sorted = [...rects].sort((a, b) => a.top - b.top);
		const merged: LocalRect[] = [];
		let current = { ...sorted[0] };

		for (let i = 1; i < sorted.length; i++) {
			const r = sorted[i];
			if (Math.abs(r.top - current.top) < 2) {
				const left = Math.min(current.left, r.left);
				const right = Math.max(current.left + current.width, r.left + r.width);
				const top = Math.min(current.top, r.top);
				const bottom = Math.max(current.top + current.height, r.top + r.height);
				current = { left, top, width: right - left, height: bottom - top };
			} else {
				merged.push(current);
				current = { ...r };
			}
		}
		merged.push(current);
		return merged;
	}

	let endpointRects: LocalRect[] = $state([]);

	$effect(() => {
		const usesPartialRects =
			classification === 'start' ||
			classification === 'end' ||
			(classification === 'single-block' && containerPaintsRects);
		if (!usesPartialRects) {
			endpointRects = [];
			return;
		}
		if (!blockRef?.measurePartialRects || !blockEl || !selection?.anchor || !selection?.focus) {
			endpointRects = [];
			return;
		}

		const { start, end } = normalize({ anchor: selection.anchor, focus: selection.focus });

		const startOffset =
			classification === 'end' ? 0 : start.offset;
		const endOffset =
			classification === 'start' ? SELECTION_END : end.offset;

		const viewportRects: DOMRect[] = blockRef.measurePartialRects(startOffset, endOffset);
		const blockRect = blockEl.getBoundingClientRect();
		endpointRects = mergeRectsPerLine(
			viewportRects.map((r) => ({
				left: r.left - blockRect.left,
				top: r.top - blockRect.top,
				width: r.width,
				height: r.height
			}))
		);
	});
</script>

{#if classification === 'middle'}
	<div class="selection-overlay selection-overlay-middle" contenteditable="false"></div>
{:else if classification === 'start' || classification === 'end' || (classification === 'single-block' && containerPaintsRects)}
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
