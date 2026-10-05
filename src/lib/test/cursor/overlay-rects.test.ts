// @vitest-environment jsdom
// Needs jsdom for `Range.getClientRects`. Rects are zero-sized under jsdom, so this suite
// only checks the boundary handling; e2e covers real pixel measurement.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { asDomTextOffset } from '../../cursor/coordinate-spaces';
import { measurePartialRectsInContentEditable, reachLineEdges } from '../../cursor/overlay-rects';

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

// Miss-analysis: the endpoint rects were only ever checked for staying inside their block, so
// nothing compared an end block's paint with the full-width boxes of the blocks between.
describe('reachLineEdges', () => {
	// Two lines in a 500 by 52 block: the first from x 40, the second from the block's left edge.
	const LINES = [
		{ left: 40, top: 4, width: 100, height: 20 },
		{ left: 0, top: 28, width: 60, height: 20 }
	];

	it('runs a start from its point to the right edge, then takes every line below whole', () => {
		expect(reachLineEdges(LINES, 'start', 500, 52)).toEqual([
			{ left: 40, top: 4, width: 460, height: 20 },
			{ left: 0, top: 24, width: 500, height: 28 }
		]);
	});

	it('takes every line above an end whole, then runs from the left edge to its point', () => {
		expect(reachLineEdges(LINES, 'end', 500, 52)).toEqual([
			{ left: 0, top: 0, width: 500, height: 28 },
			{ left: 0, top: 28, width: 60, height: 20 }
		]);
	});

	it('adds no strip where a line already meets the block’s edge', () => {
		const line = { left: 40, top: 0, width: 100, height: 20 };
		expect(reachLineEdges([line], 'start', 500, 20)).toEqual([
			{ left: 40, top: 0, width: 460, height: 20 }
		]);
		expect(reachLineEdges([line], 'end', 500, 20)).toEqual([
			{ left: 0, top: 0, width: 140, height: 20 }
		]);
	});

	// A long code line scrolls past the block's box, and the paint follows it.
	it('reaches past the box to a line wider than it', () => {
		const wide = { left: 10, top: 0, width: 900, height: 20 };
		expect(reachLineEdges([wide], 'start', 500, 20)).toEqual([
			{ left: 10, top: 0, width: 900, height: 20 }
		]);
	});

	it('paints nothing where nothing was measured', () => {
		expect(reachLineEdges([], 'start', 500, 52)).toEqual([]);
	});
});
