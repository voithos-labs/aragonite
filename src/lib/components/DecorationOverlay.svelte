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
		hasChildHosts = false
	}: {
		path: number[];
		blockRef: BlockComponent | undefined;
		blockEl: HTMLElement | null | undefined;
		/** Containers paint nothing — children self-paint — EXCEPT grid surfaces
		 *  (table) whose cells aren't BlockHosted; those paint whole-cell marks. */
		isContainer?: boolean;
		/** False for a childless container (render-primary plugin block): no child
		 *  block-hosts exist to paint, so the block takes the mark overlay itself
		 *  (SelectionOverlay carries the same route). */
		hasChildHosts?: boolean;
	} = $props();

	const services = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY);
	const engine = services?.decorations;
	const { editorRoot: getEditorRoot } = getContext<EditorDoc>(EDITOR_DOC_KEY);

	/** A mark's `interactive.onClick` is author code on a user gesture, so it routes
	 *  to the same seam every other decoration entry point uses (editor.md §12)
	 *  rather than surfacing as an unattributed window error. */
	function runInteraction(run: () => void): void {
		try {
			run();
		} catch (error) {
			services?.events.emit('error', { origin: 'decoration', error, context: { path } });
		}
	}

	// A grid container (table) supplies cellRect, so its descendant cell marks —
	// which never get their own BlockHost overlay — paint as whole cells here.
	const containerPaintsCells = $derived(isContainer && !!blockRef?.cellRect);
	// A childless container has no child hosts to delegate to; when its shim can
	// measure a range (opaque single-unit) it paints the mark on itself.
	const containerPaintsSelf = $derived(
		isContainer && !hasChildHosts && !!blockRef?.measurePartialRects
	);

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
		// Read the owning bucket up front so this effect registers the reactive
		// decoration set as a dependency: `sourceCount` is a plain counter, so a
		// source added after mount would otherwise never re-run this effect.
		const marks = eng
			? containerPaintsCells
				? eng.marksForDescendants(path)
				: eng.marksForPath(path)
			: [];
		if (!eng || eng.sourceCount === 0 || !el) {
			rects = [];
			return;
		}
		if (isContainer && !containerPaintsCells && !containerPaintsSelf) {
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
					// A collapsed range can still emit a degenerate zero-width client
					// rect (a line-boundary fragment); it would paint an invisible sliver.
					if (r.width <= 0) continue;
					out.push(toLocal(r, blockRect, dec));
				}
			}
			return out;
		}

		// A grid's descendant cell marks paint as whole cells; several marks in one
		// cell collapse to a single rect whose class is their union (collapseCellMarks).
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

		const editorRoot = getEditorRoot?.();
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
