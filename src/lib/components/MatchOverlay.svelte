<script lang="ts">
	import { getContext } from 'svelte';
	import type { BlockComponent } from '../block-component';
	import { SEARCH_KEY, EDITOR_ROOT_KEY } from '../editor-keys';
	import type { SearchState } from '../reactivity/search-state.svelte';
	import { wireOverlayRemeasure } from '../cursor/overlay-remeasure';
	import { isStrictAncestorOf } from '../selection/path-math';

	let {
		path,
		blockRef,
		blockEl,
		isContainer = false
	}: {
		path: number[];
		blockRef: BlockComponent | undefined;
		blockEl: HTMLElement | null | undefined;
		/** Containers paint nothing — children self-paint — EXCEPT grid surfaces
		 *  (table) whose cells aren't BlockHosted; those paint whole-cell matches. */
		isContainer?: boolean;
	} = $props();

	const search = getContext<SearchState | undefined>(SEARCH_KEY);
	const getEditorRoot = getContext<() => HTMLElement | null>(EDITOR_ROOT_KEY);

	// A grid container (table) supplies cellRect, so its descendant cell matches
	// — which never get their own BlockHost overlay — paint as whole cells here.
	const containerPaintsCells = $derived(isContainer && !!blockRef?.cellRect);

	interface Painted {
		left: number;
		top: number;
		width: number;
		height: number;
		active: boolean;
	}
	let rects = $state<Painted[]>([]);

	$effect(() => {
		const s = search,
			ref = blockRef,
			el = blockEl;
		if (!s || !s.isOpen || !el) {
			rects = [];
			return;
		}
		if (isContainer && !containerPaintsCells) {
			rects = [];
			return;
		}

		function measure(): void {
			if (!s || !el) return;
			const blockRect = el.getBoundingClientRect();
			rects = containerPaintsCells ? measureCells(s, blockRect) : measureLeaf(s, ref, blockRect);
		}

		function measureLeaf(state: SearchState, leaf: BlockComponent | undefined, blockRect: DOMRect) {
			if (!leaf?.measurePartialRects) return [];
			const out: Painted[] = [];
			// Only this leaf's matches (grouped once per rescan), not a full-document scan.
			for (const { match, index } of state.matchesForPath(path)) {
				for (const r of leaf.measurePartialRects!(match.start, match.end)) {
					// Empty matches never reach here — the collapsed-range guard in overlay-rects
					// drops them upstream. This drops a degenerate zero-width client rect a
					// non-collapsed match can still emit from `getClientRects` (e.g. a line-boundary
					// fragment), which would otherwise paint an invisible sliver.
					if (r.width <= 0) continue;
					out.push(toLocal(r, blockRect, index === state.activeIndex));
				}
			}
			return out;
		}

		// Several matches can land in one cell; collapse to one highlight, active
		// if any of its matches is the active match.
		function measureCells(state: SearchState, blockRect: DOMRect) {
			if (!ref?.cellRect) return [];
			const byCell = new Map<string, { rowIdx: number; colIdx: number; active: boolean }>();
			state.matches.forEach((m, i) => {
				if (!isStrictAncestorOf(path, m.path)) return;
				const rowIdx = m.path[path.length];
				const colIdx = m.path[path.length + 1];
				if (rowIdx == null || colIdx == null) return;
				const key = `${rowIdx},${colIdx}`;
				const existing = byCell.get(key);
				const active = (existing?.active ?? false) || i === state.activeIndex;
				byCell.set(key, { rowIdx, colIdx, active });
			});
			const out: Painted[] = [];
			for (const { rowIdx, colIdx, active } of byCell.values()) {
				const r = ref.cellRect(rowIdx, colIdx);
				if (r) out.push(toLocal(r, blockRect, active));
			}
			return out;
		}

		function toLocal(r: DOMRect, blockRect: DOMRect, active: boolean): Painted {
			return {
				left: r.left - blockRect.left,
				top: r.top - blockRect.top,
				width: r.width,
				height: r.height,
				active
			};
		}

		const editorRoot = getEditorRoot?.();
		return wireOverlayRemeasure({ el, editorRoot, blockRef: ref, measure });
	});
</script>

{#each rects as r}
	<div
		class="match-overlay"
		class:match-overlay-active={r.active}
		contenteditable="false"
		style="left:{r.left}px;top:{r.top}px;width:{r.width}px;height:{r.height}px;"
	></div>
{/each}

<style>
	.match-overlay {
		position: absolute;
		pointer-events: none;
		background: var(--search-match-bg);
		z-index: 1;
		border-radius: 2px;
	}
	.match-overlay-active {
		background: var(--search-match-active-bg);
	}
</style>
