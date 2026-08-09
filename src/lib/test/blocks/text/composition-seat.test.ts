// @vitest-environment jsdom
// The per-composition capture: one window from noteStart to the commit, holding the inputs the
// commit's own re-arm has spent by the time the run arrives. The relocation table itself is
// edge-seat's suite; the mode gate sits at the surface (editable-surface-composition-seat).
import { describe, it, expect } from 'vitest';
import { parseInline } from '$lib/core/inline';
import { createCompositionSeat } from '$lib/components/blocks/text/composition-seat';
import type { InlineMarkKind } from '$lib/cursor/pending-marks';
import type { EdgeAffinity } from '$lib/cursor/edge-affinity';

const BOLD = 'Some **bold** text';

interface Live {
	display: string;
	/** Held at the pre-composition parse, as in production: commits are skipped mid-window,
	 *  so the component's live inline read still answers the pre-composition tree. */
	inlines: ReturnType<typeof parseInline>;
	affinity: EdgeAffinity | null;
	marks: ReadonlySet<InlineMarkKind> | null;
	range: { start: number; end: number } | null;
	rangeEdits: Array<{ range: { start: number; end: number }; typed: string }>;
}

function makeSeat(live: Live) {
	return createCompositionSeat({
		getDisplayText: () => live.display,
		getInlines: () => live.inlines,
		getAffinity: () => live.affinity,
		consumePendingMarks: () => live.marks,
		getRawSelection: () => live.range,
		resolveRangeEdit: (range, typed) => {
			live.rangeEdits.push({ range, typed });
			return { raw: `cleaned:${typed}`, caret: 1 };
		}
	});
}

function liveState(display: string, affinity: EdgeAffinity | null = null): Live {
	return {
		display,
		inlines: parseInline(display, 0, display.length),
		affinity,
		marks: null,
		range: null,
		rangeEdits: []
	};
}

describe('the window is captured at noteStart, not read at the commit', () => {
	it('relocates against the display and affinity the composition opened at', () => {
		const live = liveState(BOLD, 'far');
		const seat = makeSeat(live);
		seat.noteStart();
		// The surface's own start half re-arms the affinity and the DOM moves mid-window.
		live.affinity = 'near';
		live.display = 'unrelated';
		expect(seat.relocate('Some **boldかん** text', 11)).toEqual({
			raw: 'Some **bold**かん text',
			caret: 15
		});
	});

	it('answers null outside a window — before any start, and after noteEnd', () => {
		const live = liveState(BOLD, 'far');
		const seat = makeSeat(live);
		expect(seat.relocate('Some **boldかん** text', 11)).toBeNull();
		seat.noteStart();
		seat.noteEnd();
		expect(seat.relocate('Some **boldかん** text', 11)).toBeNull();
	});
});

describe('pending marks beat the arrival side', () => {
	it('wraps the composed run in the marks the caret chain lacks', () => {
		const live = liveState('hello', 'far');
		live.marks = new Set<InlineMarkKind>(['strong']);
		const seat = makeSeat(live);
		seat.noteStart();
		expect(seat.relocate('helloかん', 5)).toEqual({ raw: 'hello**かん**', caret: 9 });
	});
});

describe('a selection captured at noteStart routes the commit to the join seam', () => {
	it('hands the seam the range and the extracted run', () => {
		const live = liveState(BOLD, 'far');
		live.range = { start: 5, end: 13 };
		const seat = makeSeat(live);
		seat.noteStart();
		expect(seat.relocate('Some かん text', 5)).toEqual({ raw: 'cleaned:かん', caret: 1 });
		expect(live.rangeEdits).toEqual([{ range: { start: 5, end: 13 }, typed: 'かん' }]);
	});

	it('declines a read that is not a replacement of the captured range', () => {
		const live = liveState(BOLD, 'far');
		live.range = { start: 5, end: 13 };
		const seat = makeSeat(live);
		seat.noteStart();
		expect(seat.relocate('Xome かん text', 5)).toBeNull();
		expect(live.rangeEdits).toEqual([]);
	});
});
