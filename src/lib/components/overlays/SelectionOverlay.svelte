<script lang="ts">
	import { getContext } from 'svelte';
	import type { BlockComponent } from '../../block-component';
	import {
		EDITOR_DOC_KEY,
		EDITOR_SERVICES_KEY,
		type EditorDoc,
		type EditorServices
	} from '../../editor-keys';
	import {
		blockPaintsWholeBox,
		classifyBlockForSelection,
		endpointMeasureSpan
	} from '../../selection/primitives';
	import { wireOverlayRemeasure } from './remeasure';
	import type { LocalRect } from '../../core/coordinate-spaces';
	import { mergeRectsPerLine, reachLineEdges } from './rects';
	import { WHOLE_BLOCK_INPUT_ATTR } from '../../selection/whole-block-input';
	import { gridCellOf } from '../../core/coordinate-spaces';
	import { componentAt } from '../../block-lists/child-list';

	let {
		path,
		blockRef,
		blockEl,
		delegatesPainting = false
	}: {
		path: number[];
		/** How the endpoint rects are measured, and where: a delegating container passes neither,
		 *  since it never measures. */
		blockRef?: BlockComponent;
		blockEl?: HTMLElement | null;
		/** This container's children paint the range's endpoint rects, so it measures none. Decided
		 *  at BlockHost, which hands the same answer to DecorationOverlay. */
		delegatesPainting?: boolean;
	} = $props();

	// Optional, like every context BlockHost reads: a mount without the editor shell
	// provides none, and every use below is written for absence.
	const services = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY);
	const selection = services?.selection;
	const getEditorRoot = getContext<EditorDoc | undefined>(EDITOR_DOC_KEY)?.editorRoot;

	const coverage = $derived(services?.rangeCoverage() ?? null);

	// A grid's cells have no host of their own, so a finger's word in one paints here.
	const rangeCell = $derived(
		coverage && blockRef?.cellRect ? gridCellOf(path, coverage.range.start.path) : null
	);

	const classification = $derived(
		rangeCell ? 'single-block' : coverage ? classifyBlockForSelection(path, coverage) : 'outside'
	);

	// Ignores who measures, on purpose: a block the range covers whole paints one box over
	// everything it renders, markers included, and its children already paint nothing under it.
	const paintsWholeBox = $derived(
		coverage !== null && blockPaintsWholeBox(path, coverage, selection?.wholeUnitPath ?? null)
	);

	// The effect and the markup read this one value, so a painted rectangle is one the effect
	// measured. A range inside one block is a grid's rectangle, or a finger's range in a leaf or cell.
	const paintsEndpoints = $derived(
		!delegatesPainting &&
			!paintsWholeBox &&
			(classification === 'start' || classification === 'end' || classification === 'single-block')
	);

	let endpointRects: LocalRect[] = $state([]);

	// Read off the block's text, since a heading or a code block sets its own; NaN for `normal`.
	function textLineHeight(host: HTMLElement): number {
		const text =
			host.querySelector<HTMLElement>(
				`[contenteditable="true"]:not([${WHOLE_BLOCK_INPUT_ATTR}])`
			) ?? host;
		return parseFloat(getComputedStyle(text).lineHeight);
	}

	$effect(() => {
		if (!paintsEndpoints) {
			endpointRects = [];
			return;
		}
		if (!blockRef?.measurePartialRects || !blockEl || !services || !coverage) {
			endpointRects = [];
			return;
		}

		const ref = blockRef;
		const el = blockEl;
		const covered = services.rangeCoverage;
		const cell = rangeCell;

		function measure(): void {
			const live = covered();
			const cells = cell && ref.childList?.();
			const measurer = cell ? cells && componentAt(cells, [cell.row, cell.col]) : ref;
			if (!live || !measurer?.measurePartialRects) return;
			const { from, to, textSide } = endpointMeasureSpan(classification, live);
			const viewportRects: DOMRect[] = measurer.measurePartialRects(from, to);
			const blockRect = el.getBoundingClientRect();
			const lines = mergeRectsPerLine(
				viewportRects.map((r) => ({
					left: r.left - blockRect.left,
					top: r.top - blockRect.top,
					width: r.width,
					height: r.height
				}))
			);
			endpointRects = textSide
				? reachLineEdges(lines, textSide, blockRect.width, blockRect.height, textLineHeight(el))
				: lines;
		}

		const editorRoot = getEditorRoot?.() ?? null;
		return wireOverlayRemeasure({
			el,
			editorRoot,
			blockRef: ref,
			measure,
			textMoves: services.textMoves
		});
	});
</script>

{#if paintsWholeBox}
	<div class="selection-overlay selection-overlay-middle" contenteditable="false"></div>
{:else if paintsEndpoints}
	{#each endpointRects as rect, i (i)}
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
