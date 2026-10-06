// @vitest-environment jsdom
// Needs jsdom for `Range.getClientRects`. Rects are zero-sized under jsdom, so this suite
// only checks the boundary handling; e2e covers real pixel measurement.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { asDomTextOffset } from '../../cursor/coordinate-spaces';
import {
	holesBetween,
	measurePartialRectsInContentEditable,
	reachLineEdges
} from '../../cursor/overlay-rects';

describe('measurePartialRectsInContentEditable', () => {
	let el: HTMLDivElement;

	beforeEach(() => {
		el = document.createElement('div');
		el.contentEditable = 'true';
		el.textContent = 'hello world';
		document.body.appendChild(el);
	});

	afterEach(() => {
		el.remove();
	});

	it('returns an empty array for a zero-length range', () => {
		const rects = measurePartialRectsInContentEditable(el, asDomTextOffset(3), asDomTextOffset(3));
		expect(rects).toEqual([]);
	});

	it('clamps out-of-range offsets without throwing', () => {
		expect(() =>
			measurePartialRectsInContentEditable(el, asDomTextOffset(0), asDomTextOffset(9999))
		).not.toThrow();
	});
});

// Miss-analysis: the rows set each line's glyphs flush with its neighbours, so no row had the
// leading a real line keeps above and below its text, where the strips began.
describe('reachLineEdges', () => {
	// A 500 by 56 block with 2px padding and two 26px lines, each 20px of glyphs from x 40 and 0.
	const LINES = [
		{ left: 40, top: 5, width: 100, height: 20 },
		{ left: 0, top: 31, width: 60, height: 20 }
	];

	it('runs a start from its point to the right edge over its line box, then the lines below', () => {
		expect(reachLineEdges(LINES, 'start', 500, 56, 26)).toEqual([
			{ left: 40, top: 2, width: 460, height: 26 },
			{ left: 0, top: 28, width: 500, height: 26 }
		]);
	});

	it('takes the lines above an end, then runs from the left edge to its point over its line box', () => {
		expect(reachLineEdges(LINES, 'end', 500, 56, 26)).toEqual([
			{ left: 0, top: 2, width: 500, height: 26 },
			{ left: 0, top: 28, width: 60, height: 26 }
		]);
	});

	it('leaves the block’s padding to the paint between blocks', () => {
		const line = { left: 40, top: 5, width: 100, height: 20 };
		expect(reachLineEdges([line], 'start', 500, 30, 26)).toEqual([
			{ left: 40, top: 2, width: 460, height: 26 }
		]);
		expect(reachLineEdges([line], 'end', 500, 30, 26)).toEqual([
			{ left: 0, top: 2, width: 140, height: 26 }
		]);
	});

	it('keeps to the glyphs where they overlap the next line, so nothing paints twice', () => {
		const tight = [
			{ left: 40, top: 0, width: 100, height: 20 },
			{ left: 0, top: 16, width: 60, height: 20 }
		];
		expect(reachLineEdges(tight, 'start', 500, 36, 16)).toEqual([
			{ left: 40, top: 0, width: 460, height: 20 },
			{ left: 0, top: 20, width: 500, height: 16 }
		]);
		expect(reachLineEdges(tight, 'end', 500, 36, 16)).toEqual([
			{ left: 0, top: 0, width: 500, height: 16 },
			{ left: 0, top: 16, width: 60, height: 20 }
		]);
	});

	it('keeps to the glyphs where the line height is `normal`', () => {
		expect(reachLineEdges(LINES, 'start', 500, 56, NaN)[0]).toEqual({
			left: 40,
			top: 5,
			width: 460,
			height: 20
		});
	});

	it('keeps a line box inside its block', () => {
		const flush = { left: 40, top: 0, width: 100, height: 20 };
		expect(reachLineEdges([flush], 'start', 500, 20, 26)).toEqual([
			{ left: 40, top: 0, width: 460, height: 20 }
		]);
	});

	// A long code line scrolls past the block's box, and the paint follows it.
	it('reaches past the box to a line wider than it', () => {
		const wide = { left: 10, top: 0, width: 900, height: 20 };
		expect(reachLineEdges([wide], 'start', 500, 20, 20)).toEqual([
			{ left: 10, top: 0, width: 900, height: 20 }
		]);
	});

	it('paints nothing where nothing was measured', () => {
		expect(reachLineEdges([], 'start', 500, 56, 26)).toEqual([]);
	});
});

describe('holesBetween', () => {
	it('returns each stretch between the first band and the last that no band covers', () => {
		const bands = [
			{ top: 40, bottom: 60 },
			{ top: 0, bottom: 26 },
			{ top: 30, bottom: 45 },
			{ top: 64, bottom: 90 }
		];
		expect(holesBetween(bands)).toEqual([
			{ top: 26, bottom: 30 },
			{ top: 60, bottom: 64 }
		]);
	});

	it('finds no hole where bands meet edge to edge or nest', () => {
		expect(
			holesBetween([
				{ top: 0, bottom: 100 },
				{ top: 20, bottom: 40 },
				{ top: 100, bottom: 120 }
			])
		).toEqual([]);
	});

	it('paints nothing above the first band, below the last, or with nothing painted', () => {
		expect(holesBetween([{ top: 50, bottom: 60 }])).toEqual([]);
		expect(holesBetween([])).toEqual([]);
	});
});
