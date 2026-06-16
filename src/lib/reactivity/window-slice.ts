/**
 * The single source of truth for the windowed-slice bounds. A consumer renders
 * `children.slice(start, end)` and MUST key/index each rendered child by its
 * ABSOLUTE index `start + localIndex` — never the local loop index. Leaking the
 * local index corrupts paths and structural ops invisibly (spec: "the single
 * most dangerous implementation detail"). BlockList and ListBlock both route
 * their bounds through here so that contract lives in exactly one place.
 */
import type { WindowResult } from './block-window.svelte';

export function sliceWindow(
	childCount: number,
	win: WindowResult | undefined
): { start: number; end: number } {
	if (!win?.active) return { start: 0, end: childCount };
	// Clamp defensively: a window derived from a prior, longer children array can
	// arrive one reactive tick before the slice re-derives against the new length.
	const start = Math.min(win.start, childCount);
	const end = Math.min(win.end, childCount);
	return { start, end: Math.max(start, end) };
}
