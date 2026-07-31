<script lang="ts">
	import { getContext } from 'svelte';
	import type { BlockComponent } from '../block-component';
	import {
		EDITOR_DOC_KEY,
		EDITOR_SERVICES_KEY,
		type EditorDoc,
		type EditorServices
	} from '../editor-keys';
	import type { MarkDecoration } from '../decorations/types';
	import { collapseCellMarks, type IndexedDecoration } from '../decorations/buckets';
	import { wireOverlayRemeasure } from '../cursor/overlay-remeasure';

	let {
		path,
		blockRef,
		blockEl,
		isContainer = false,
		containerPaintsRects = false
	}: {
		path: number[];
		blockRef: BlockComponent | undefined;
		blockEl: HTMLElement | null | undefined;
		/** Containers paint nothing — children self-paint — except grids, whose cells
		 *  aren't BlockHosted and so paint whole-cell marks here. */
		isContainer?: boolean;
		/** Decided at BlockHost, which hands the same value to SelectionOverlay. */
		containerPaintsRects?: boolean;
	} = $props();

	const services = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY);
	const engine = services?.decorations;
	// Optional for the same reason `services` is: a bare mount provides no shell.
	const getEditorRoot = getContext<EditorDoc | undefined>(EDITOR_DOC_KEY)?.editorRoot;

	/** A mark's `interactive.onClick` is author code on a user gesture, so it routes to
	 *  the same error seam as every other decoration entry point (editor.md §12). */
	function runInteraction(run: () => void): void {
		try {
			run();
		} catch (error) {
			services?.events.emit('error', { origin: 'decoration', error, context: { path } });
		}
	}

	// A grid supplies cellRect, so its descendant cell marks — which get no BlockHost
	// overlay of their own — paint as whole cells here.
	const containerPaintsCells = $derived(isContainer && !!blockRef?.cellRect);

	interface Painted {
		left: number;
		top: number;
		width: number;
		height: number;
		cls: string;
		attrs?: Record<string, string>;
		onClick?: (ev: MouseEvent) => void;
	}
	let rects = $state<Painted[]>([]);

	$effect(() => {
		const eng = engine,
			ref = blockRef,
			el = blockEl;
		// Read the bucket up front so this effect registers the reactive decoration set
		// as a dependency: `sourceCount` is a plain counter, so a source added after
		// mount would otherwise never re-run it.
		const marks = eng
			? containerPaintsCells
				? eng.marksForDescendants(path)
				: eng.marksForPath(path)
			: [];
		if (!eng || eng.sourceCount === 0 || !el) {
			rects = [];
			return;
		}
		if (isContainer && !containerPaintsCells && !containerPaintsRects) {
			rects = [];
			return;
		}

		function measure(): void {
			if (!el) return;
			const blockRect = el.getBoundingClientRect();
			rects = containerPaintsCells
				? measureCells(marks, blockRect)
				: measureLeaf(marks, ref, blockRect);
		}

		function measureLeaf(
			leafMarks: IndexedDecoration<MarkDecoration>[],
			leaf: BlockComponent | undefined,
			blockRect: DOMRect
		): Painted[] {
			if (!leaf?.measurePartialRects) return [];
			const out: Painted[] = [];
			for (const { dec } of leafMarks) {
				for (const r of leaf.measurePartialRects(dec.start, dec.end)) {
					// A collapsed range still emits a degenerate zero-width rect at a line
					// boundary, which would paint an invisible sliver.
					if (r.width <= 0) continue;
					out.push(toLocal(r, blockRect, dec));
				}
			}
			return out;
		}

		// Several marks in one cell collapse to a single rect whose class is their union.
		function measureCells(
			descMarks: IndexedDecoration<MarkDecoration>[],
			blockRect: DOMRect
		): Painted[] {
			if (!ref?.cellRect) return [];
			const out: Painted[] = [];
			for (const { rowIdx, colIdx, class: cls, dec } of collapseCellMarks(descMarks, path.length)) {
				const r = ref.cellRect(rowIdx, colIdx);
				if (r) out.push(toLocal(r, blockRect, dec, cls));
			}
			return out;
		}

		function toLocal(
			r: DOMRect,
			blockRect: DOMRect,
			dec: MarkDecoration,
			cls = dec.class
		): Painted {
			const interactive = dec.interactive;
			return {
				left: r.left - blockRect.left,
				top: r.top - blockRect.top,
				width: r.width,
				height: r.height,
				cls,
				attrs: dec.attrs,
				onClick: interactive
					? (ev: MouseEvent) => runInteraction(() => interactive.onClick(dec, ev))
					: undefined
			};
		}

		const editorRoot = getEditorRoot?.() ?? null;
		return wireOverlayRemeasure({ el, editorRoot, blockRef: ref, measure });
	});
</script>

{#each rects as r, i (i)}
	<div
		{...r.attrs}
		class="decoration-overlay {r.cls}"
		class:decoration-overlay-interactive={!!r.onClick}
		contenteditable="false"
		style="left:{r.left}px;top:{r.top}px;width:{r.width}px;height:{r.height}px;"
		onclick={r.onClick}
	></div>
{/each}
