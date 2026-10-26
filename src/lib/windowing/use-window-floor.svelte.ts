/**
 * Holds a windowed list's box at its table height while a window change renders (VR-16). The new
 * blocks mount one at a time, and a layout read between two of them would otherwise see a list
 * short by the rest and clamp the scroll to it. Call during init of the component that renders
 * the list's spacers.
 */
import { aroundRender } from '../around-render.svelte';
import type { WindowResult } from './block-window.svelte';

export function useWindowFloor(
	getBox: () => HTMLElement | null | undefined,
	getWindow: () => WindowResult | undefined
): void {
	let held: HTMLElement | null = null;
	aroundRender(
		getWindow,
		(win) => {
			const box = getBox();
			if (!box || !win?.active || win.floorPx <= 0) return;
			box.style.minHeight = `${win.floorPx}px`;
			held = box;
		},
		// Released at the end of every render it held, before the browser's next size reports: a
		// hold left over would move the box inside a later delivery, which the browser reports as a loop.
		() => {
			if (!held) return;
			held.style.minHeight = '';
			held = null;
		}
	);
}
