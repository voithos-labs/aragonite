<script lang="ts">
	import { getContext } from 'svelte';
	import type { BlockComponent } from '../block-component';
	import {
		EDITOR_DOC_KEY,
		EDITOR_SERVICES_KEY,
		type EditorDoc,
		type EditorServices
	} from '../editor-keys';
	import {
		blockPaintsWholeBox,
		classifyBlockForSelection,
		endpointMeasureSpan
	} from '../selection/primitives';
	import { wireOverlayRemeasure } from '../cursor/overlay-remeasure';
	import { mergeRectsPerLine, reachLineEdges, type LocalRect } from '../cursor/overlay-rects';
	import { WHOLE_BLOCK_INPUT_ATTR } from '../editor-actions/whole-block-focus-surface';

	let {
		path,
		blockRef,
		blockEl,
		delegatesPainting = false,
		containerPaintsRects = false
	}: {
		path: number[];
		/** How the endpoint rects are measured, and where: a delegating container passes neither,
		 *  since it never measures. */
		blockRef?: BlockComponent;
		blockEl?: HTMLElement | null;
		/** This container's children paint the range's endpoint rects, so it measures none. */
		delegatesPainting?: boolean;
		/** This container measures its own rects instead of delegating. Both are decided
		 *  at BlockHost, which hands the same pair to DecorationOverlay. */
		containerPaintsRects?: boolean;
	} = $props();

	// Optional, like every context BlockHost reads: a mount without the editor shell
	// provides none, and every use below is written for absence.
	const services = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY);
	const selection = services?.selection;
	const getEditorRoot = getContext<EditorDoc | undefined>(EDITOR_DOC_KEY)?.editorRoot;

	const coverage = $derived(services?.rangeCoverage() ?? null);

	const classification = $derived(coverage ? classifyBlockForSelection(path, coverage) : 'outside');

	// Ignores who measures, on purpose: a block the range covers whole paints one box over
	// everything it renders, markers included, and its children already paint nothing under it.
	const paintsWholeBox = $derived(
		coverage !== null && blockPaintsWholeBox(path, coverage, selection?.wholeUnitPath ?? null)
	);

	// The measuring effect and the markup read this one value, so a painted rectangle is
	// always one the effect measured; two separate tests would paint a stale box.
	const paintsEndpoints = $derived(
		!delegatesPainting &&
			(classification === 'start' ||
				classification === 'end' ||
				(classification === 'single-block' && containerPaintsRects))
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

		function measure(): void {
			const live = covered();
			if (!live || !ref.measurePartialRects) return;
			const { from, to, textSide } = endpointMeasureSpan(classification, live);
			const viewportRects: DOMRect[] = ref.measurePartialRects(from, to);
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
		return wireOverlayRemeasure({ el, editorRoot, blockRef: ref, measure });
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
