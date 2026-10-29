// @vitest-environment jsdom
// Miss-analysis: the line read ran only under the soft-line delete, which no perf row presses, so
// nothing timed a long code block's Home. jsdom lays nothing out, so a range's rects are set here.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { lineBoxNearest } from '../../browser/visual-lines';
import { expectBoundedGrowth, measureScanGrowth } from '../harness/scan-growth';

let rects: DOMRect[] = [];
const original = Range.prototype.getClientRects;

beforeEach(() => {
	Range.prototype.getClientRects = () => rects as unknown as DOMRectList;
});

afterEach(() => {
	Range.prototype.getClientRects = original;
});

/** One rect per token, `perLine` to a 20px line, in document order. */
function tokenRects(lines: number, perLine: number): DOMRect[] {
	const out: DOMRect[] = [];
	for (let line = 0; line < lines; line++) {
		for (let token = 0; token < perLine; token++)
			out.push(new DOMRect(token * 10, line * 20, 8, 20));
	}
	return out;
}

const el = document.createElement('div');

describe('lineBoxNearest', () => {
	it('joins the rects of one line and picks the line nearest the point', () => {
		rects = tokenRects(3, 4);
		expect(lineBoxNearest(el, 30)).toEqual({ top: 20, bottom: 40, left: 0, right: 38 });
		// Below the last line, the last line.
		expect(lineBoxNearest(el, 500)).toEqual({ top: 40, bottom: 60, left: 0, right: 38 });
	});

	it('a tall rect joins the line it overlaps first, growing it', () => {
		rects = [
			new DOMRect(0, 0, 10, 20),
			new DOMRect(0, 20, 10, 20),
			new DOMRect(20, 10, 30, 25),
			new DOMRect(60, 20, 10, 20)
		];
		expect(lineBoxNearest(el, 5)).toEqual({ top: 0, bottom: 40, left: 0, right: 70 });
	});

	it('a line a tall rect grew down still takes a rect that also overlaps the last line', () => {
		rects = [
			new DOMRect(0, 0, 10, 20),
			new DOMRect(0, 20, 10, 20),
			new DOMRect(0, 40, 10, 20),
			new DOMRect(20, 10, 10, 35),
			new DOMRect(50, 42, 10, 16)
		];
		expect(lineBoxNearest(el, 5)).toEqual({ top: 0, bottom: 58, left: 0, right: 60 });
	});

	it('skips a rect with no width or height', () => {
		rects = [new DOMRect(0, 0, 10, 20), new DOMRect(500, 0, 0, 20)];
		expect(lineBoxNearest(el, 10)?.right).toBe(10);
	});

	it('reads a block of many lines in time linear in its rects', () => {
		// Ten rects per line; the source's length only sizes the block.
		const byKb = new Map<number, DOMRect[]>();
		const growth = measureScanGrowth(
			(source) => {
				const kb = Math.round(source.length / 1024);
				let block = byKb.get(kb);
				if (!block) byKb.set(kb, (block = tokenRects(kb * 16, 10)));
				rects = block;
				lineBoxNearest(el, 10);
			},
			'x',
			[24, 96]
		);
		expectBoundedGrowth(growth);
	}, 300_000);
});
