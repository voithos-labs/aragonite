// Miss-analysis: the snap's geometry was only ever exercised through blocks holding ONE island,
// where "the first island the point is past" and "the island nearest the point" agree, so no test
// could tell the two rules apart and a run of flush islands always answered the first.
import { describe, it, expect } from 'vitest';
import { nearestWidgetEdgeOffset, type WidgetEdgeCandidate } from '../../cursor/widget-edge-snap';

const ROW = { top: 0, bottom: 20 };

/** Four flush glyph islands on one row, each 20px wide and 7 raw bytes long. */
function flushRun(count: number, firstStart = 0): WidgetEdgeCandidate[] {
	return Array.from({ length: count }, (_, i) => ({
		start: firstStart + i * 7,
		end: firstStart + (i + 1) * 7,
		rect: { left: 100 + i * 20, right: 120 + i * 20, ...ROW }
	}));
}

describe('nearestWidgetEdgeOffset', () => {
	it('answers the LAST island of a run for a point past it, not the first one passed', () => {
		expect(nearestWidgetEdgeOffset(flushRun(4), 200, 10)).toBe(28);
	});

	it('answers a lone island the same way', () => {
		expect(nearestWidgetEdgeOffset(flushRun(1), 200, 10)).toBe(7);
	});

	it('answers the first island for a point left of the run', () => {
		expect(nearestWidgetEdgeOffset(flushRun(4), 90, 10)).toBe(0);
	});

	it('answers the shared offset on the seam between two flush islands', () => {
		// The trailing edge of one island and the leading edge of the next are the same byte, so
		// the tie between them cannot be observed.
		expect(nearestWidgetEdgeOffset(flushRun(4), 120, 10)).toBe(7);
	});

	it('declines a point inside an island, which owns its own click', () => {
		expect(nearestWidgetEdgeOffset(flushRun(4), 150, 10)).toBeNull();
	});

	it('declines when there is no island at all', () => {
		expect(nearestWidgetEdgeOffset([], 150, 10)).toBeNull();
	});

	it('prefers an island on the point’s own row over a nearer one on another row', () => {
		// Two block images stack: the same x-range, different rows. A click beside the lower one
		// must not reach the upper one's trailing edge.
		const stacked: WidgetEdgeCandidate[] = [
			{ start: 0, end: 31, rect: { left: 24, right: 56, top: 0, bottom: 24 } },
			{ start: 31, end: 62, rect: { left: 24, right: 56, top: 32, bottom: 56 } }
		];

		expect(nearestWidgetEdgeOffset(stacked, 58, 44)).toBe(62);
		expect(nearestWidgetEdgeOffset(stacked, 58, 12)).toBe(31);
	});

	it('reads horizontal containment alone as inside when the point names no row', () => {
		expect(nearestWidgetEdgeOffset(flushRun(4), 150, null)).toBeNull();
		expect(nearestWidgetEdgeOffset(flushRun(4), 200, null)).toBe(28);
	});
});
