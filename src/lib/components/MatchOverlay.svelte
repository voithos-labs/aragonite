<script lang="ts">
	import { getContext } from 'svelte';
	import type { BlockComponent } from '../block-component';
	import { SEARCH_KEY, EDITOR_ROOT_KEY, type SearchState } from '../editor-keys';
	import { firstScrollableDescendant, nearestScrollContainer } from '../cursor/scroll-ancestors';
	import { pathsEqual } from '../selection/path-math';

	let {
		path,
		blockRef,
		blockEl
	}: {
		path: number[];
		blockRef: BlockComponent | undefined;
		blockEl: HTMLElement | null | undefined;
	} = $props();

	const search = getContext<SearchState | undefined>(SEARCH_KEY);
	const getEditorRoot = getContext<() => HTMLElement | null>(EDITOR_ROOT_KEY);

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
		if (!s || !s.isOpen || !ref?.measurePartialRects || !el) {
			rects = [];
			return;
		}
		const mine = s.matches.map((m, i) => ({ m, i })).filter(({ m }) => pathsEqual(m.path, path));
		function measure(): void {
			if (!s || !ref?.measurePartialRects || !el) return;
			const blockRect = el.getBoundingClientRect();
			const out: Painted[] = [];
			for (const { m, i } of mine) {
				for (const r of ref.measurePartialRects(m.start, m.end)) {
					out.push({
						left: r.left - blockRect.left,
						top: r.top - blockRect.top,
						width: r.width,
						height: r.height,
						active: i === s.activeIndex
					});
				}
			}
			rects = out;
		}
		measure();
		const editorRoot = getEditorRoot?.();
		const scrollEl =
			firstScrollableDescendant(el) ?? (editorRoot ? nearestScrollContainer(el, editorRoot) : null);
		if (!scrollEl) return;
		scrollEl.addEventListener('scroll', measure, { passive: true });
		return () => scrollEl.removeEventListener('scroll', measure);
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
