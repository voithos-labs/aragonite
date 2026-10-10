// @vitest-environment jsdom
// A plain arrow at a code chip's hidden edge moves the typing offset across the chip's border, not
// the caret; a mark's edge has no stop. The key wiring is `presentation-live-edge-step.spec.ts`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	chipStops,
	typingOffset,
	resolveEdgeSeat,
	edgeStep,
	edgeStops
} from '#lib/components/blocks/text/edge-seat.js';
import { parseInline } from '#lib/core/inline/index.js';
import { screenVisibility } from '#lib/core/inline/visibility.js';
import type { EdgeAffinity } from '#lib/caret/edge-affinity.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';

const LIVE = screenVisibility('live', { chromePaints: false });

const tree = (source: string) => parseInline(source, 0, source.length);

function step(
	source: string,
	caret: number,
	record: EdgeAffinity | null,
	direction: 'backward' | 'forward'
) {
	return edgeStep(caret, tree(source), record, source, LIVE, fixtureReading(), direction);
}

// `via `code` end`: the chip [4,10), `code` [5,9); its closer is [9,10), its opener [4,5).
const CHIP = 'via `code` end';

// A click or an arrival names a side, not an offset; the opener's inside is its far end.
describe('a code chip’s stops, by side', () => {
	it.each([
		['the closer', 9, { inside: 9, outside: 10 }],
		['the closer, from past it', 10, { inside: 9, outside: 10 }],
		['the opener', 4, { inside: 5, outside: 4 }],
		['the opener, from inside it', 5, { inside: 5, outside: 4 }]
	])('at %s', (_name, caret, stops) => {
		expect(chipStops(caret, tree(CHIP), CHIP, LIVE, fixtureReading())).toEqual(stops);
	});

	it('a mark has none', () => {
		const BOLD = 'Some **bold** text';
		expect(chipStops(11, tree(BOLD), BOLD, LIVE, fixtureReading())).toBeNull();
	});
});

describe('a code chip’s closer', () => {
	it('steps out past the border from inside, then lets the caret move', () => {
		expect(step(CHIP, 9, null, 'forward')).toBe(10);
		expect(step(CHIP, 9, { offset: 10 }, 'forward')).toBeNull();
	});

	it('steps back in from outside, then lets the caret move', () => {
		expect(step(CHIP, 9, { offset: 10 }, 'backward')).toBe(9);
		expect(step(CHIP, 9, null, 'backward')).toBeNull();
	});

	it('writes the next byte where the step put it', () => {
		expect(
			resolveEdgeSeat(9, tree(CHIP), { offset: 10 }, CHIP, LIVE, ')', fixtureReading())
		).toEqual({ offset: 10, kind: 'inlineCode' });
	});
});

describe('a code chip’s opener', () => {
	// The character before the opener is a space, so with no record the caret means outside.
	it('steps in past the opener, and out again', () => {
		expect(step(CHIP, 4, null, 'forward')).toBe(5);
		expect(step(CHIP, 4, { offset: 5 }, 'backward')).toBe(4);
		expect(step(CHIP, 4, { offset: 5 }, 'forward')).toBeNull();
	});
});

describe('a chip ending its line', () => {
	const END = 'via `scheduled`';

	it('offers the offset past the closing backtick', () => {
		expect(edgeStops(14, tree(END), END, LIVE, fixtureReading())).toEqual([14, 15]);
		expect(step(END, 14, null, 'forward')).toBe(15);
	});
});

describe('where there is no stop', () => {
	it.each([
		['bold', 'Some **bold** text', 11],
		['a bold opener', 'Some **bold** text', 5],
		['abutting closers', 'a ***both***', 9],
		['a link', 'see [here](https://x.example)', 9],
		['plain text', 'Some **bold** text', 2]
	])('%s: the arrow moves the caret', (_name, source, caret) => {
		expect(edgeStops(caret, tree(source), source, LIVE, fixtureReading())).toEqual([]);
		expect(step(source, caret, null, 'forward')).toBeNull();
		expect(step(source, caret, null, 'backward')).toBeNull();
	});

	// A bold abutting the chip adds no stop of its own: only the border's two sides are stops.
	it('a bold beside a chip adds none', () => {
		const MIXED = 'a `c`**b** d';
		expect(edgeStops(5, tree(MIXED), MIXED, LIVE, fixtureReading())).toEqual([4, 5]);
	});
});

describe('a stop the caret’s position no longer holds', () => {
	it('reads as no record', () => {
		expect(typingOffset(4, tree(CHIP), { offset: 10 }, CHIP, LIVE, fixtureReading())).toBe(4);
	});
});

// Every typed byte asks for its edge, so the block is rendered only where a hidden run is touched.
// Miss-analysis: only the ship-time perf gate bounded what the typing path renders.
describe('what the edge reads off the render', () => {
	beforeEach(() => {
		resetPerfInstruments();
		enablePerfInstruments();
	});
	afterEach(() => disablePerfInstruments());

	it('reads nothing for a caret away from every construct edge', () => {
		expect(resolveEdgeSeat(2, tree(CHIP), null, CHIP, LIVE, 'x', fixtureReading())).toBeNull();
		expect(edgeStops(2, tree(CHIP), CHIP, LIVE, fixtureReading())).toEqual([]);
		expect(perfSnapshot().screenReads).toBe(0);
	});

	it('reads the render at a hidden edge', () => {
		expect(edgeStops(9, tree(CHIP), CHIP, LIVE, fixtureReading())).toEqual([9, 10]);
		expect(perfSnapshot().screenReads).toBeGreaterThan(0);
	});
});
