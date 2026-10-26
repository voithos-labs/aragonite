/**
 * Which of a block list's children are mounted, each as an entry carrying the child's absolute
 * index and id. A list loops over `entries` keyed by `id` and hands each child its entry's fields.
 */
import type { WindowResult } from './block-window.svelte';

/** A mounted child, with its absolute index and id worked out alongside it. */
export interface SliceEntry<T> {
	readonly node: T;
	readonly index: number;
	readonly id: string;
}

export interface WindowSlice<T> {
	start: number;
	end: number;
	entries: SliceEntry<T>[];
}

/** One list's slicer. A call hands back the last call's entry for a child whose node and index
 *  haven't changed, so a recomputed slice re-renders only the children that did. */
export function windowSlicer<T>(): (
	children: readonly T[],
	ids: readonly string[],
	win: WindowResult | undefined
) => WindowSlice<T> {
	let last = new Map<string, SliceEntry<T>>();
	return (children, ids, win) => {
		const { start, end } = windowBounds(children.length, win);
		const entries = new Array<SliceEntry<T>>(end - start);
		const kept = new Map<string, SliceEntry<T>>();
		for (let i = start; i < end; i++) {
			const id = ids[i];
			const previous = last.get(id);
			const entry =
				previous && previous.node === children[i] && previous.index === i
					? previous
					: { node: children[i], index: i, id };
			entries[i - start] = entry;
			kept.set(id, entry);
		}
		last = kept;
		return { start, end, entries };
	};
}

// Clamped to the child count, so a stale window never over-slices; an inverted one is empty (VR-14).
function windowBounds(
	childCount: number,
	win: WindowResult | undefined
): { start: number; end: number } {
	if (!win?.active) return { start: 0, end: childCount };
	const start = Math.min(win.start, childCount);
	const end = Math.min(win.end, childCount);
	return { start, end: Math.max(start, end) };
}
