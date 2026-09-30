/**
 * Holds a windowed list's box at its table height while a window change renders (VR-16). The new
 * blocks mount one at a time, and a layout read between two of them would otherwise see a list
 * short by the rest and clamp the scroll to it. Call during init of the component that renders
 * the list's spacers.
 */
import { untrack } from 'svelte';
import type { WindowResult } from './block-window.svelte';

export function useWindowFloor(
	getBox: () => HTMLElement | null | undefined,
	getWindow: () => WindowResult | undefined
): void {
	let held: HTMLElement | null = null;
	$effect.pre(() => {
		const win = getWindow();
		const box = untrack(getBox);
		if (!box || !win?.active || win.floorPx <= 0) return;
		box.style.minHeight = `${win.floorPx}px`;
		held = box;
	});
	// Gone before the browser's next size reports: a box held past a child's shrink would move
	// the container around it inside that delivery, which the browser reports as a loop.
	$effect(() => {
		void getWindow();
		if (!held) return;
		held.style.minHeight = '';
		held = null;
	});
}
