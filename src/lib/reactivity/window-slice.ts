/**
 * The one place the mounted range's bounds are computed. A consumer renders
 * `children.slice(start, end)` and must key and index each rendered child by its absolute
 * index, `start + localIndex`, never the local loop index: letting the local index escape
 * corrupts paths and structural operations invisibly (`docs/design/virtual-rendering.md`).
 */
import type { WindowResult } from './block-window.svelte';

export function sliceWindow(
	childCount: number,
	win: WindowResult | undefined
): { start: number; end: number } {
	if (!win?.active) return { start: 0, end: childCount };
	const start = Math.min(win.start, childCount);
	const end = Math.min(win.end, childCount);
	return { start, end: Math.max(start, end) };
}
