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
	if (!win) return { start: 0, end: childCount };
	// The window can lag the children by one pass. Clamp an inactive one too, or a one-block
	// window over a swapped-in large document mounts every block for that pass.
	const start = Math.min(win.start, childCount);
	const end = Math.min(win.end, childCount);
	return { start, end: Math.max(start, end) };
}
