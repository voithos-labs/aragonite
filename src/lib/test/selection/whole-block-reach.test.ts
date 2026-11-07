// A block with no positions inside joins a drag past its centre line, or for a finger a line past
// its edge when that's nearer, from whichever side the anchor sits.
import { describe, it, expect } from 'vitest';
import { reachesWholeBlock } from '#lib/selection/drag-pointer.js';

const TALL = { top: 100, height: 300 };
const SHORT = { top: 100, height: 30 };
const ABOVE = [0];
const BELOW = [2];
const BLOCK = [1];

describe('reachesWholeBlock', () => {
	for (const [name, box, anchor, y, finger, want] of [
		['a finger a line into a tall block from above', TALL, ABOVE, 124, true, true],
		['a finger short of a line into a tall block from above', TALL, ABOVE, 123, true, false],
		['a mouse a line into a tall block from above', TALL, ABOVE, 124, false, false],
		['a mouse past a tall block’s middle from above', TALL, ABOVE, 250, false, true],
		['a finger a line into a tall block from below', TALL, BELOW, 376, true, true],
		['a finger short of a line into a tall block from below', TALL, BELOW, 377, true, false],
		['a finger short of a short block’s middle', SHORT, ABOVE, 114, true, false],
		['a finger past a short block’s middle', SHORT, ABOVE, 115, true, true]
	] as const) {
		it(`${name}: ${want ? 'joins' : 'waits'}`, () => {
			expect(reachesWholeBlock(box, anchor, BLOCK, y, finger)).toBe(want);
		});
	}

	it('a block with no box to measure joins', () => {
		expect(reachesWholeBlock(undefined, ABOVE, BLOCK, 0, false)).toBe(true);
	});
});
