// Miss-analysis: the snap's geometry was only ever exercised on blocks holding one widget,
// where "the first widget the point is past" and "the widget nearest the point" agree, so no
// test could tell the two rules apart and a row of touching widgets always answered the first.
// The case for a point inside one had the same shape: every candidate was selected whole, so
// "inside declines" read as geometry rather than as the select-the-whole-thing rule it is.
import { describe, it, expect } from 'vitest';
import { nearestWidgetEdgeSeat, type WidgetEdgeCandidate } from '../../cursor/widget-edge-snap';

const ROW = { top: 0, bottom: 20 };

/** Four touching widgets on one row, each 20px wide and 7 raw bytes long. `seatsInside` is the
 *  rule for a widget that behaves like a character: a click on the glyph names an edge instead
 *  of selecting the whole thing. */
function flushRun(count: number, seatsInside = false): WidgetEdgeCandidate[] {
	return Array.from({ length: count }, (_, i) => ({
		start: i * 7,
		end: (i + 1) * 7,
		rect: { left: 100 + i * 20, right: 120 + i * 20, ...ROW },
		seatsInside
	}));
}

const edgeAt = (candidates: WidgetEdgeCandidate[], x: number, y: number | null): number | null =>
	nearestWidgetEdgeSeat(candidates, x, y)?.offset ?? null;

describe('nearestWidgetEdgeSeat', () => {
	it('answers the last widget of a run for a point past it, not the first one passed', () => {
		expect(edgeAt(flushRun(4), 200, 10)).toBe(28);
	});

	it('answers a lone widget the same way', () => {
		expect(edgeAt(flushRun(1), 200, 10)).toBe(7);
	});

	it('answers the first widget for a point left of the run', () => {
		expect(edgeAt(flushRun(4), 90, 10)).toBe(0);
	});

	it('answers the shared offset on the join between two flush widgets', () => {
		// The trailing edge of one widget and the leading edge of the next are the same byte, so the
		// tie between them cannot be observed.
		expect(edgeAt(flushRun(4), 120, 10)).toBe(7);
	});

	it('declines a point inside a whole-select widget, which owns its own click', () => {
		expect(edgeAt(flushRun(4), 150, 10)).toBeNull();
	});

	it('declines when there is no widget at all', () => {
		expect(edgeAt([], 150, 10)).toBeNull();
	});

	it('prefers a widget on the point’s own row over a nearer one on another row', () => {
		// Two block images stack: the same x range, different rows. A click beside the lower one
		// must not reach the upper one's trailing edge.
		const stacked: WidgetEdgeCandidate[] = [
			{ start: 0, end: 31, rect: { left: 24, right: 56, top: 0, bottom: 24 }, seatsInside: false },
			{ start: 31, end: 62, rect: { left: 24, right: 56, top: 32, bottom: 56 }, seatsInside: false }
		];

		expect(edgeAt(stacked, 58, 44)).toBe(62);
		expect(edgeAt(stacked, 58, 12)).toBe(31);
	});

	it('reads horizontal containment alone as inside when the point names no row', () => {
		expect(edgeAt(flushRun(4), 150, null)).toBeNull();
		expect(edgeAt(flushRun(4), 200, null)).toBe(28);
	});

	// ── Inside a widget that behaves like a character ────────────────────────

	it('puts the caret at the nearer edge by side for a point inside a character-like widget', () => {
		// The third widget spans 140..160 and raw [14,21): its left half names 14, its right 21.
		expect(edgeAt(flushRun(4, true), 145, 10)).toBe(14);
		expect(edgeAt(flushRun(4, true), 155, 10)).toBe(21);
	});

	it('marks the inside caret position, which no browser caret of the point’s own stands against', () => {
		expect(nearestWidgetEdgeSeat(flushRun(4, true), 145, 10)?.inside).toBe(true);
		expect(nearestWidgetEdgeSeat(flushRun(4, true), 200, 10)?.inside).toBe(false);
	});
});
