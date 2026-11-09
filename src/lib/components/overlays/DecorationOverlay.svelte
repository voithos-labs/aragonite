<script lang="ts">
	import { getContext, untrack } from 'svelte';
	import type { BlockComponent } from '../../block-component';
	import {
		EDITOR_DOC_KEY,
		EDITOR_SERVICES_KEY,
		type EditorDoc,
		type EditorServices
	} from '../../editor-keys';
	import type { NodeView } from '../../core/node-views';
	import type { MarkDecoration } from '../../decorations/types';
	import { collapseCellMarks, type IndexedDecoration } from '../../decorations/buckets';
	import {
		leafMarkRects,
		paintOrder,
		takesPointer,
		winningMark
	} from '../../decorations/mark-interactions';
	import type { HoverTarget } from '../../decorations/mark-hover';
	import { wireOverlayRemeasure } from './remeasure';
	import { recordMarkMeasure } from '../../perf/instruments';

	let {
		node,
		path,
		blockRef,
		blockEl,
		isContainer = false,
		containerPaintsRects = false
	}: {
		node: NodeView;
		path: number[];
		blockRef: BlockComponent | undefined;
		blockEl: HTMLElement | null | undefined;
		/** Containers paint nothing, since their children paint themselves, except grids:
		 *  their cells have no BlockHost of their own, so whole-cell marks paint here. */
		isContainer?: boolean;
		/** Decided at BlockHost, which hands the same value to SelectionOverlay. */
		containerPaintsRects?: boolean;
	} = $props();

	const services = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY);
	const engine = services?.decorations;
	// Optional for the same reason `services` is: a mount without the editor shell has none.
	const getEditorRoot = getContext<EditorDoc | undefined>(EDITOR_DOC_KEY)?.editorRoot;

	// A grid supplies cellRect, so marks on its cells, which have no BlockHost overlay
	// of their own, paint as whole cells here.
	const containerPaintsCells = $derived(isContainer && !!blockRef?.cellRect);

	interface Painted {
		left: number;
		top: number;
		width: number;
		height: number;
		cls: string;
		attrs?: Record<string, string>;
		clickMark?: MarkDecoration;
	}
	let rects = $state.raw<Painted[]>([]);
	const NO_MARKS: readonly IndexedDecoration<MarkDecoration>[] = [];

	// The hover tracker's key for what this overlay painted, dropped when it unmounts.
	const owner = {};
	$effect(() => () => engine?.markHover.unpaint(owner));

	function click(r: Painted, ev: MouseEvent): void {
		const mark = r.clickMark;
		if (mark) engine?.runMarkHandler(mark, () => mark.interactive?.onClick?.(mark, ev));
	}

	// Untracked: the hit-test runs plugin code, whose reads must not subscribe this effect.
	function paintHover(el: HTMLElement | null, targets: HoverTarget[]): void {
		untrack(() => engine?.markHover.paint(owner, el, targets));
	}

	// A derived, so the effect below reruns only when the block's marks are new arrays.
	const blockMarks = $derived(
		!engine
			? NO_MARKS
			: containerPaintsCells
				? engine.marksForDescendants(path)
				: engine.paintOf(node, path).marks
	);

	$effect(() => {
		const eng = engine,
			ref = blockRef,
			el = blockEl,
			marks = blockMarks;
		// An unmarked block wires nothing, so a scroll or a moved marker measures marked blocks only.
		if (
			!eng ||
			!el ||
			marks.length === 0 ||
			(isContainer && !containerPaintsCells && !containerPaintsRects)
		) {
			rects = [];
			paintHover(null, []);
			return;
		}

		function measure(): void {
			if (!el) return;
			recordMarkMeasure(path);
			const blockRect = el.getBoundingClientRect();
			const hover: HoverTarget[] = [];
			rects = containerPaintsCells
				? measureCells(marks, blockRect, hover)
				: measureLeaf(marks, ref, blockRect, hover);
			paintHover(el, hover);
		}

		function measureLeaf(
			leafMarks: readonly IndexedDecoration<MarkDecoration>[],
			leaf: BlockComponent | undefined,
			blockRect: DOMRect,
			hover: HoverTarget[]
		): Painted[] {
			if (!leaf?.measurePartialRects) return [];
			const out: Painted[] = [];
			for (const mark of paintOrder(leafMarks)) {
				const { dec } = mark;
				const own = leafMarkRects(leaf, dec).map((r) => ({
					...toLocal(r, blockRect, dec.class, dec.attrs),
					clickMark: takesPointer(dec) ? dec : undefined
				}));
				for (const painted of own) out.push(painted);
				if (dec.interactive?.onHover && own.length > 0) hover.push({ mark, rects: own });
			}
			return out;
		}

		// Several marks in one cell collapse to a single rect whose class is their union; the
		// precedence rule names which of them answers a click, and the hit-test which a hover.
		function measureCells(
			descMarks: readonly IndexedDecoration<MarkDecoration>[],
			blockRect: DOMRect,
			hover: HoverTarget[]
		): Painted[] {
			if (!ref?.cellRect) return [];
			const out: Painted[] = [];
			for (const cell of collapseCellMarks(descMarks, path)) {
				const r = ref.cellRect(cell.rowIdx, cell.colIdx);
				if (!r) continue;
				const painted = {
					...toLocal(r, blockRect, cell.class, cell.dec.attrs),
					clickMark: winningMark(cell.marks, takesPointer)?.dec
				};
				out.push(painted);
				for (const mark of cell.marks) {
					if (mark.dec.interactive?.onHover) hover.push({ mark, rects: [painted] });
				}
			}
			return out;
		}

		function toLocal(
			r: DOMRect,
			blockRect: DOMRect,
			cls: string,
			attrs: Record<string, string> | undefined
		): Painted {
			return {
				left: r.left - blockRect.left,
				top: r.top - blockRect.top,
				width: r.width,
				height: r.height,
				cls,
				attrs
			};
		}

		const editorRoot = getEditorRoot?.() ?? null;
		return wireOverlayRemeasure({
			el,
			editorRoot,
			blockRef: ref,
			measure,
			measureSoon: services?.scrollOwner.measureSoon,
			textMoves: services?.textMoves
		});
	});
</script>

{#each rects as r, i (i)}
	<div
		{...r.attrs}
		class="decoration-overlay {r.cls}"
		class:decoration-overlay-interactive={!!r.clickMark}
		contenteditable="false"
		style="left:{r.left}px;top:{r.top}px;width:{r.width}px;height:{r.height}px;"
		onclick={r.clickMark ? (ev) => click(r, ev) : undefined}
	></div>
{/each}
