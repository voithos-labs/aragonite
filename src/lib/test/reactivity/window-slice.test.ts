import { describe, it, expect } from 'vitest';
import { sliceWindow } from '../../reactivity/window-slice';
import type { WindowResult } from '../../reactivity/block-window.svelte';

const active = (start: number, end: number): WindowResult => ({
	active: true,
	start,
	end,
	topSpacerPx: 0,
	bottomSpacerPx: 0
});

describe('sliceWindow', () => {
	it('returns the full range when the window is inactive or absent', () => {
		expect(sliceWindow(10, undefined)).toEqual({ start: 0, end: 10 });
		expect(sliceWindow(10, { ...active(2, 5), active: false })).toEqual({ start: 0, end: 10 });
	});

	it('returns the window range when active', () => {
		expect(sliceWindow(100, active(18, 32))).toEqual({ start: 18, end: 32 });
	});

	it('clamps the range to the child count (a stale window must never over-slice)', () => {
		expect(sliceWindow(5, active(2, 99))).toEqual({ start: 2, end: 5 });
		expect(sliceWindow(3, active(10, 20))).toEqual({ start: 3, end: 3 });
	});

	// VR-14: an inverted window (end < start) — from a stale derive — must collapse to
	// an empty slice, never a negative-length one. The clamp-to-childCount cases above
	// all have start <= end, so only this case exercises the Math.max(start, end) guard.
	it('collapses an inverted window to an empty slice at start', () => {
		expect(sliceWindow(100, active(30, 10))).toEqual({ start: 30, end: 30 });
	});
});
