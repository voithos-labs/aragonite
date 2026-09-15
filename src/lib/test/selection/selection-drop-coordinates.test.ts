// The two pure reads the drop ceremony needs between its halves: where the drop lands once the
// source range left the block, and where a splice at the source leaves the target's path.
// Miss-analysis: the browser's own drop resolved both natively, so no unit ever had to.
import { describe, it, expect } from 'vitest';
import { dropOffsetAfterCut, shiftPathAfterSplice } from '$lib/selection/selection-drop';

describe('dropOffsetAfterCut', () => {
	it('leaves a drop before the cut alone', () => {
		expect(dropOffsetAfterCut(2, 6, 10, 4)).toBe(2);
	});

	it('pulls a drop after the cut back by what the cut actually removed', () => {
		expect(dropOffsetAfterCut(14, 6, 10, 5)).toBe(9);
	});

	it('keeps a drop at the cut where it is', () => {
		expect(dropOffsetAfterCut(6, 6, 10, 4)).toBe(6);
	});

	it('declines a drop inside the range being moved', () => {
		expect(dropOffsetAfterCut(8, 6, 10, 4)).toBeNull();
	});

	it('never lands before the start of the block', () => {
		expect(dropOffsetAfterCut(11, 6, 10, 20)).toBe(0);
	});
});

describe('shiftPathAfterSplice', () => {
	it('moves a later sibling by the splice delta', () => {
		expect(shiftPathAfterSplice([3], [], 1, 2)).toEqual([3 + 2]);
	});

	it('leaves an earlier sibling alone', () => {
		expect(shiftPathAfterSplice([0], [], 1, 2)).toEqual([0]);
	});

	it('leaves a path in another container alone', () => {
		expect(shiftPathAfterSplice([1, 4], [2], 0, 3)).toEqual([1, 4]);
	});

	it('shifts at the spliced depth, not the leaf', () => {
		expect(shiftPathAfterSplice([2, 5, 1], [], 0, 1)).toEqual([3, 5, 1]);
	});

	it('is identity when nothing was spliced', () => {
		expect(shiftPathAfterSplice([3], [], 0, 0)).toEqual([3]);
	});
});
