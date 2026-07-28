<script lang="ts">
	import { getContext } from 'svelte';
	import { SELECTION_END, type BlockComponent } from '../block-component';
	import {
		EDITOR_DOC_KEY,
		EDITOR_SERVICES_KEY,
		type EditorDoc,
		type EditorServices
	} from '../editor-keys';
	import {
		normalize,
		classifyBlockForSelection,
		charOffsetOf,
		cellIndexOf,
		type BlockSelectionClass
	} from '../selection/primitives';
	import { snapCrossBlockTableEndpoints } from '../selection/table-endpoint-snap';
	import { wireOverlayRemeasure } from '../cursor/overlay-remeasure';

	let {
		path,
		blockRef,
		blockEl,
		isContainer = false,
		hasChildHosts = false
	}: {
		path: number[];
		blockRef: BlockComponent | undefined;
		blockEl: HTMLElement | null | undefined;
		/** Container blocks skip overlays — their children paint their own. */
		isContainer?: boolean;
		/** False for a childless container (render-primary plugin block): no child
		 *  block-hosts exist to paint, so this block takes the full-block overlay
		 *  itself, like a non-text leaf. */
		hasChildHosts?: boolean;
	} = $props();

	// Optional, like every context BlockHost itself reads: a bare mount (unit
	// harness, conformance kit) provides no shell, and every use below is already
	// written for absence. Destructuring these threw before those reads ran.
	const selection = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY)?.selection;
	const editorDoc = getContext<EditorDoc | undefined>(EDITOR_DOC_KEY);
	const getEditorRoot = editorDoc?.editorRoot;
	const getDoc = editorDoc?.doc;

	// Containers that supply their own measurePartialRects (table) paint cell
	// rects from this overlay; their children don't render BlockHost wrappers.
	const containerPaintsRects = $derived(isContainer && !!blockRef?.measurePartialRects);

	const classification = $derived.by<BlockSelectionClass>(() => {
		if (isContainer && !containerPaintsRects && hasChildHosts) return 'outside';
		if (!selection?.isCustomRendered || !selection.anchor || !selection.focus) {
			return 'outside';
		}
		return classifyBlockForSelection(path, {
			anchor: selection.anchor,
			focus: selection.focus
		});
	});

	// This block paints endpoint rects (its own partial selection). The measuring
	// effect and the template read the one predicate, so a rendered rect is always
	// one the effect measured — the reverse renders a stale box.
	const paintsEndpoints = $derived(
		classification === 'start' ||
			classification === 'end' ||
			(classification === 'single-block' && containerPaintsRects)
	);

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
		if (!paintsEndpoints) {
			endpointRects = [];
			return;
		}
		if (!blockRef?.measurePartialRects || !blockEl || !selection?.anchor || !selection?.focus) {
			endpointRects = [];
			return;
		}

		const ref = blockRef;
		const el = blockEl;
		const sel = selection;

		function measure(): void {
			if (!sel.anchor || !sel.focus || !ref.measurePartialRects) return;
			const normalized = normalize({ anchor: sel.anchor, focus: sel.focus });
			const doc = getDoc?.();
			const { start, end } = doc
				? snapCrossBlockTableEndpoints(doc, normalized.start, normalized.end)
				: normalized;
			const startOffset =
				classification === 'end'
					? 0
					: start.cellCoordinate
						? cellIndexOf(start, 'SelectionOverlay:start')
						: charOffsetOf(start, 'SelectionOverlay:start');
			// measurePartialRects paints [start, end) exclusive. The +1 that turns a
			// snapped table end (inclusive last cell of its row) into an exclusive
			// whole-row bound lives in the cell branch only; the char branch carries a
			// raw offset. Both decay to number at the public door.
			const endOffset =
				classification === 'start'
					? SELECTION_END
					: end.cellCoordinate
						? cellIndexOf(end, 'SelectionOverlay:end') + 1
						: charOffsetOf(end, 'SelectionOverlay:end');
			const viewportRects: DOMRect[] = ref.measurePartialRects(startOffset, endOffset);
			const blockRect = el.getBoundingClientRect();
			endpointRects = mergeRectsPerLine(
				viewportRects.map((r) => ({
					left: r.left - blockRect.left,
					top: r.top - blockRect.top,
					width: r.width,
					height: r.height
				}))
			);
		}

		const editorRoot = getEditorRoot?.() ?? null;
		return wireOverlayRemeasure({ el, editorRoot, blockRef: ref, measure });
	});
</script>

{#if classification === 'middle'}
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
