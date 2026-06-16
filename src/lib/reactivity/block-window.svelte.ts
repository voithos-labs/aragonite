/**
 * Window math for virtual rendering. `computeWindow` is pure: given a height
 * model and the scroll viewport, it returns the [start, end) slice to mount,
 * the spacer heights that preserve native scroll geometry, the pinned-index
 * carry, and the next activation state (with hysteresis so a list at the
 * threshold doesn't thrash). The reactive `createBlockWindow` wrapper (a later
 * task) wires live getters + a scroll listener to this.
 */
import type { HeightModel } from '../cursor/height-model';

export interface WindowInputs {
	scrollTop: number; // editor scrollTop mapped into this list's coordinate range
	viewportHeight: number;
	overscan: number; // blocks to mount above and below the visible range
	pinnedIndex: number | null; // focused/caret block to keep mounted
	active: boolean; // current activation (for hysteresis)
	activateAbovePx: number; // high watermark — activate when total exceeds it
	deactivateBelowPx: number; // low watermark — deactivate when total drops below it
}

export interface WindowResult {
	active: boolean;
	start: number; // inclusive
	end: number; // exclusive
	topSpacerPx: number;
	bottomSpacerPx: number;
	pinnedIndex: number | null;
	pinnedOutside: boolean; // pin sits outside [start, end) -> split-spacer render
}

export function computeWindow(model: HeightModel, input: WindowInputs): WindowResult {
	const n = model.size;
	const total = model.total();

	// Hysteresis: cross the high watermark to turn on, fall below the low one to turn off.
	const active = input.active ? total >= input.deactivateBelowPx : total >= input.activateAbovePx;

	if (!active || n === 0) {
		return {
			active: false,
			start: 0,
			end: n,
			topSpacerPx: 0,
			bottomSpacerPx: 0,
			pinnedIndex: input.pinnedIndex,
			pinnedOutside: false
		};
	}

	const firstVisible = model.indexAtOffset(input.scrollTop);
	// Viewport bottom edge is half-open: the block whose top sits exactly at it shows
	// zero pixels, so probe one pixel inside to avoid mounting an off-screen block.
	const lastVisible = model.indexAtOffset(input.scrollTop + input.viewportHeight - 1);
	const start = Math.max(0, firstVisible - input.overscan);
	const end = Math.min(n, lastVisible + 1 + input.overscan);

	const pinnedOutside =
		input.pinnedIndex !== null && (input.pinnedIndex < start || input.pinnedIndex >= end);

	return {
		active: true,
		start,
		end,
		topSpacerPx: model.offsetOf(start),
		bottomSpacerPx: total - model.offsetOf(end),
		pinnedIndex: input.pinnedIndex,
		pinnedOutside
	};
}
