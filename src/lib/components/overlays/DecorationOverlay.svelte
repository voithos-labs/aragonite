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
	import type { IndexedDecoration } from '../../decorations/buckets';
	import { leafMarkRects, paintOrder, takesPointer } from '../../decorations/mark-interactions';
	import type { HoverTarget } from '../../decorations/mark-hover';
	import { componentAt } from '../../block-lists/child-list';
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
		 *  their cells have no BlockHost of their own, so their marks paint here. */
		isContainer?: boolean;
		/** Decided at BlockHost, which hands the same value to SelectionOverlay. */
		containerPaintsRects?: boolean;
	} = $props();

	const services = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY);
	const engine = services?.decorations;
	// Optional for the same reason `services` is: a mount without the editor shell has none.
	const getEditorRoot = getContext<EditorDoc | undefined>(EDITOR_DOC_KEY)?.editorRoot;

	// A grid supplies cellRect; its cells have no BlockHost overlay of their own, so each mounted
	// cell's marks paint here, measured by the cell like a leaf.
	const paintsCells = $derived(isContainer && !!blockRef?.cellRect);

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

	type Marks = readonly IndexedDecoration<MarkDecoration>[];
	interface CellMarks {
		row: number;
		col: number;
		marks: Marks;
	}
	const NO_MARKS: Marks = [];
	const NO_CELLS: readonly CellMarks[] = [];

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

	// Deriveds, so the effect below reruns only when some block's or cell's marks are new arrays.
	const leafMarks = $derived(engine && !paintsCells ? engine.paintOf(node, path).marks : NO_MARKS);
	let heldCells = NO_CELLS;
	const cellMarks = $derived.by(() => {
		if (!engine || !paintsCells) return NO_CELLS;
		const rows = node.children ?? [];
		const { start, end } = blockRef?.mountedRowWindow?.() ?? { start: 0, end: rows.length };
		const next: CellMarks[] = [];
		for (let row = start; row < Math.min(end, rows.length); row++) {
			rows[row].children?.forEach((cell, col) => {
				const marks = engine.paintOf(cell, [...path, row, col]).marks;
				if (marks.length > 0) next.push({ row, col, marks });
			});
		}
		const same =
			next.length === heldCells.length &&
			next.every(
				(c, i) =>
					c.marks === heldCells[i].marks && c.row === heldCells[i].row && c.col === heldCells[i].col
			);
		if (!same) heldCells = next;
		return heldCells;
	});

	$effect(() => {
		const eng = engine,
			ref = blockRef,
			el = blockEl,
			leaf = leafMarks,
			cells = cellMarks;
		// An unmarked block wires nothing, so a scroll or a moved marker measures marked blocks only.
		if (
			!eng ||
			!el ||
			(leaf.length === 0 && cells.length === 0) ||
			(isContainer && !paintsCells && !containerPaintsRects)
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
			const out: Painted[] = [];
			if (paintsCells) {
				const rows = ref?.childList?.();
				for (const cell of cells) {
					const at = rows ? componentAt(rows, [cell.row, cell.col]) : null;
					measureLeaf(cell.marks, at ?? undefined, blockRect, out, hover);
				}
			} else measureLeaf(leaf, ref, blockRect, out, hover);
			rects = out;
			paintHover(el, hover);
		}

		function measureLeaf(
			marks: Marks,
			measurer: BlockComponent | undefined,
			blockRect: DOMRect,
			out: Painted[],
			hover: HoverTarget[]
		): void {
			if (!measurer?.measurePartialRects) return;
			for (const mark of paintOrder(marks)) {
				const { dec } = mark;
				const own = leafMarkRects(measurer, dec).map((r) => ({
					...toLocal(r, blockRect, dec.class, dec.attrs),
					clickMark: takesPointer(dec) ? dec : undefined
				}));
				for (const painted of own) out.push(painted);
				if (dec.interactive?.onHover && own.length > 0) hover.push({ mark, rects: own });
			}
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
