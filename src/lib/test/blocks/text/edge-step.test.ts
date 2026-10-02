// @vitest-environment jsdom
// A plain horizontal arrow at a hidden construct edge moves the typing offset, not the caret, one boundary
// per press (live-mode.md § 4.2). Pure over the inline tree like `edge-seat.test.ts`; the key
// wiring and the ring are covered by `presentation-live-edge-step.spec.ts`.
import { describe, expect, it } from 'vitest';
import {
	typingOffset,
	resolveEdgeSeat,
	edgeStep,
	edgeStops
} from '$lib/components/blocks/text/edge-seat';
import { parseInline } from '$lib/core/inline';
import { screenVisibility } from '$lib/core/inline/visibility';
import type { EdgeAffinity } from '$lib/cursor/edge-affinity';

const LIVE = screenVisibility('live', { chromePaints: false });

const tree = (source: string) => parseInline(source, 0, source.length);

function step(
	source: string,
	caret: number,
	affinity: EdgeAffinity | null,
	direction: 'backward' | 'forward'
) {
	return edgeStep(caret, tree(source), affinity, source, LIVE, direction);
}

// `Some **bold** text`: strong [5,13), `bold` [7,11); the trailing run is [11,13).
const BOLD = 'Some **bold** text';

describe('a trailing edge', () => {
	it('steps out past the closer from inside, then lets the caret move', () => {
		expect(step(BOLD, 11, 'near', 'forward')).toBe(13);
		expect(step(BOLD, 11, { offset: 13 }, 'forward')).toBeNull();
	});

	it('steps back in from outside, then lets the caret move', () => {
		expect(step(BOLD, 11, 'far', 'backward')).toBe(11);
		expect(step(BOLD, 11, { offset: 11 }, 'backward')).toBeNull();
	});

	it('reads a click, which records nothing, as inside', () => {
		expect(step(BOLD, 11, null, 'forward')).toBe(13);
		expect(step(BOLD, 11, null, 'backward')).toBeNull();
	});
});

describe('a leading edge', () => {
	// Near is outside at an opener: the run's start.
	it('steps in past the opener, and out again', () => {
		expect(step(BOLD, 5, 'near', 'forward')).toBe(7);
		expect(step(BOLD, 5, 'far', 'backward')).toBe(5);
		expect(step(BOLD, 5, { offset: 7 }, 'forward')).toBeNull();
	});
});

describe('the construct that ends its line, the case that had no arrow out', () => {
	const CODE = 'via `scheduled`';

	it('offers the seat past the closing backtick', () => {
		expect(edgeStops(14, tree(CODE), CODE, LIVE)).toEqual([14, 15]);
		expect(step(CODE, 14, 'near', 'forward')).toBe(15);
	});

	it('writes the next byte at the seat the step chose', () => {
		expect(resolveEdgeSeat(14, tree(CODE), { offset: 15 }, CODE, LIVE, ')')).toEqual({
			offset: 15,
			kind: 'inlineCode'
		});
	});
});

describe('abutting runs', () => {
	// `a ***both***`: the closers `**` and `*` abut, so the position has three typing offsets: inside
	// both, inside the emphasis alone, and outside.
	const BOTH = 'a ***both***';

	it('takes one press per boundary', () => {
		const stops = edgeStops(9, tree(BOTH), BOTH, LIVE);
		expect(stops).toHaveLength(3);
		expect(step(BOTH, 9, 'near', 'forward')).toBe(stops[1]);
		expect(step(BOTH, 9, { offset: stops[1] }, 'forward')).toBe(stops[2]);
		expect(step(BOTH, 9, { offset: stops[2] }, 'forward')).toBeNull();
	});
});

describe('where there is no choice to make', () => {
	it('a link offers only its outside, so the arrow just moves', () => {
		const LINK = 'see [here](https://x.example)';
		expect(step(LINK, 9, 'near', 'forward')).toBeNull();
		expect(step(LINK, 9, 'near', 'backward')).toBeNull();
	});

	it('plain text has no seats', () => {
		expect(step(BOLD, 2, null, 'forward')).toBeNull();
	});
});

describe('a pinned seat', () => {
	it('is where the next byte goes while the position holds it', () => {
		expect(typingOffset(11, tree(BOLD), { offset: 13 }, BOLD, LIVE)).toBe(13);
	});

	// A pin outlives nothing but a move of the caret: at another position it names nothing there and
	// the resolver falls back to its default, the near side.
	it('reads as no record at a position that does not hold it', () => {
		expect(typingOffset(5, tree(BOLD), { offset: 13 }, BOLD, LIVE)).toBe(5);
	});
});
