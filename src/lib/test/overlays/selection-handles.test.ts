// Where a touch screen's selection handles stand: both ends of a range the editor paints, and only
// the block edges of a range the browser holds inside one block, where its own handles stop.
import { describe, it, expect } from 'vitest';
import { handleSpots, type HandleRange } from '#lib/components/overlays/selection-handles.js';
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
	handleSpots(range, rects, cellPath).map(({ end, x, top, edge }) => ({ end, x, top, edge }));

describe('handleSpots', () => {
	it('stands at both ends of a range across blocks', () => {
		expect(spots({ start: at([0], 3), end: at([1], 6), painted: true })).toEqual([
			{ end: 'start', x: 30, top: 0, edge: false },
			{ end: 'end', x: 60, top: 30, edge: false }
		]);
	});

	it("takes a block held whole by its box's corners", () => {
		expect(spots({ start: at([2], 0), end: at([2], 3), painted: true })).toEqual([
			{ end: 'start', x: 0, top: 60, edge: false },
			{ end: 'end', x: 100, top: 60, edge: false }
		]);
	});

	it("takes a cell rectangle's first and last cells' corners", () => {
		expect(spots({ start: at([3], 0, true), end: at([3], 3, true), painted: true })).toEqual([
			{ end: 'start', x: 0, top: 90, edge: false },
			{ end: 'end', x: 100, top: 110, edge: false }
		]);
	});

	it('leaves a range inside one block, clear of its edges, to the browser', () => {
		expect(spots({ start: at([0], 2), end: at([0], 5), painted: false })).toEqual([]);
	});

	it("adds a handle at each block edge a one-block range's ends reach", () => {
		expect(spots({ start: at([1], 0), end: at([1], 4), painted: false })).toEqual([
			{ end: 'start', x: 0, top: 30, edge: true }
		]);
		expect(spots({ start: at([1], 4), end: at([1], CHARS), painted: false })).toEqual([
			{ end: 'end', x: 100, top: 30, edge: true }
		]);
	});

	it('stands nowhere for a caret or no selection', () => {
		expect(spots({ start: at([0], 0), end: at([0], 0), painted: false })).toEqual([]);
		expect(spots(null)).toEqual([]);
	});
});
