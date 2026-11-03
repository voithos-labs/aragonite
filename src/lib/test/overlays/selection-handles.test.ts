// Where a touch screen's selection handles stand: both ends of the range the editor paints, inside
// one block or across several, and nowhere while it paints none.
import { describe, it, expect } from 'vitest';
import {
	handleRange,
	handleSpots,
	type HandleRange
} from '#lib/components/overlays/selection-handles.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import { fingerPress } from '#lib/selection/pointer-gesture.js';
import { SELECTION_END } from '#lib/block-component.js';

// Blocks of ten 10px characters on one line each, 20px tall, stacked 30px apart; block 2 is a rule
// (no characters) and block 3 a 2x2 table whose cells are 50px wide.
const CHARS = 10;
function rect(left: number, top: number, width: number, height: number): DOMRect {
	return { left, top, width, height, right: left + width, bottom: top + height } as DOMRect;
}
const rects = {
	rangeRects(path: number[], start: number, end: number): DOMRect[] {
		const top = path[0] * 30;
		if (path[0] === 2) return [];
		const to = end === SELECTION_END ? CHARS : Math.min(end, CHARS);
		return start < to ? [rect(start * 10, top, (to - start) * 10, 20)] : [];
	},
	blockRect(path: number[]): DOMRect {
		// A table cell's path is [table, row, column].
		if (path.length === 3) return rect(path[2] * 50, path[0] * 30 + path[1] * 20, 50, 20);
		return rect(0, path[0] * 30, 100, 20);
	}
};
const cellPath = (p: { path: number[]; offset: number }) => [
	...p.path,
	Math.floor(p.offset / 2),
	p.offset % 2
];

const at = (path: number[], offset: number, cellCoordinate?: true) => ({
	path,
	offset,
	...(cellCoordinate && { cellCoordinate })
});
const spots = (range: HandleRange | null) =>
	handleSpots(range, rects, cellPath).map(({ end, x, top }) => ({ end, x, top }));

describe('handleSpots', () => {
	it('stands at both ends of a range across blocks', () => {
		expect(spots({ start: at([0], 3), end: at([1], 6) })).toEqual([
			{ end: 'start', x: 30, top: 0 },
			{ end: 'end', x: 60, top: 30 }
		]);
	});

	it("takes a block held whole by its box's corners", () => {
		expect(spots({ start: at([2], 0), end: at([2], 3) })).toEqual([
			{ end: 'start', x: 0, top: 60 },
			{ end: 'end', x: 100, top: 60 }
		]);
	});

	it("takes a cell rectangle's first and last cells' corners", () => {
		expect(spots({ start: at([3], 0, true), end: at([3], 3, true) })).toEqual([
			{ end: 'start', x: 0, top: 90 },
			{ end: 'end', x: 100, top: 110 }
		]);
	});

	it("stands at both ends of a finger's range inside one block, its edges included", () => {
		expect(spots({ start: at([0], 2), end: at([0], 5) })).toEqual([
			{ end: 'start', x: 20, top: 0 },
			{ end: 'end', x: 50, top: 0 }
		]);
		expect(spots({ start: at([1], 0), end: at([1], CHARS) })).toEqual([
			{ end: 'start', x: 0, top: 30 },
			{ end: 'end', x: 100, top: 30 }
		]);
	});

	it('stands nowhere while the editor paints no range', () => {
		expect(spots(null)).toEqual([]);
	});
});

describe('handleRange', () => {
	it("is the range the editor paints, a finger's inside one block included", () => {
		const press = fingerPress({ pointerType: 'touch', pointerId: 1 })!;
		const selection = createSelectionState();
		expect(handleRange(selection)).toBeNull();
		selection.ownBlockRange(at([0], 2), at([0], 5), press);
		expect(handleRange(selection)).toEqual({ start: at([0], 2), end: at([0], 5) });
	});

	it("is nothing for a range inside one block a mouse made, which the browser's paints", () => {
		const selection = createSelectionState();
		selection.enterCrossBlock(at([0], 2), at([0], 5));
		expect(handleRange(selection)).toBeNull();
	});
});
