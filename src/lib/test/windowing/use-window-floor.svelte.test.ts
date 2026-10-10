// @vitest-environment jsdom
// The list's box is held at its table height only across a render that has a height to hold, and
// a box never held is never written; the e2e rows in `view-swap-end-scroll.spec.ts` prove the hold.
import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import { useWindowFloor } from '../../windowing/use-window-floor.svelte';
import type { WindowResult } from '../../windowing/block-window.svelte';

const WINDOWED: WindowResult = {
	active: true,
	start: 10,
	end: 20,
	topSpacerPx: 400,
	bottomSpacerPx: 300,
	floorPx: 1200
};
// A collapsed body's clamp: active, one row, and no height to hold.
const COLLAPSED: WindowResult = {
	...WINDOWED,
	start: 0,
	end: 1,
	topSpacerPx: 0,
	bottomSpacerPx: 0,
	floorPx: 0
};
const OFF: WindowResult = { ...WINDOWED, active: false, floorPx: 0 };

/** A box whose `min-height` writes are recorded in order, and a window the test can move. */
function mountFloor(initial: WindowResult) {
	const writes: string[] = [];
	const box = document.createElement('div');
	Object.defineProperty(box.style, 'minHeight', {
		get: () => writes.at(-1) ?? '',
		set: (value: string) => writes.push(value)
	});
	let win = $state(initial);
	const stop = $effect.root(() => {
		useWindowFloor(
			() => box,
			() => win
		);
	});
	flushSync();
	return {
		writes,
		move(next: WindowResult) {
			win = next;
			flushSync();
		},
		stop
	};
}

describe('useWindowFloor', () => {
	it('holds a windowed box at its table height for one render, then lets go', () => {
		const floor = mountFloor(WINDOWED);
		floor.move({ ...WINDOWED, start: 8, topSpacerPx: 320 });
		expect(floor.writes).toEqual(['1200px', '', '1200px', '']);
		floor.stop();
	});

	it('writes nothing for a collapsed body or a list that is not windowing', () => {
		const floor = mountFloor(COLLAPSED);
		floor.move(OFF);
		floor.move({ ...OFF, end: 12 });
		expect(floor.writes).toEqual([]);
		floor.stop();
	});
});
