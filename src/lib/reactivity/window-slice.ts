/**
 * The one home for the windowed-slice bounds. A consumer renders `children.slice(start,
 * end)` and MUST key/index each rendered child by its ABSOLUTE index `start + localIndex`,
 * never the local loop index — leaking the local index corrupts paths and structural ops
 * invisibly (`docs/design/virtual-rendering.md`).
 */
import type { WindowResult } from './block-window.svelte';

export function sliceWindow(
	childCount: number,
	win: WindowResult | undefined
): { start: number; end: number } {
	if (!win?.active) return { start: 0, end: childCount };
	// A window derived from a prior, longer children array can arrive one reactive tick
	// before the slice re-derives against the new length.
	const start = Math.min(win.start, childCount);
	const end = Math.min(win.end, childCount);
	return { start, end: Math.max(start, end) };
}
