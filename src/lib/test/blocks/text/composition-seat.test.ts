// @vitest-environment jsdom
// What one composition captures, from `noteStart` to the commit: the values the commit itself has
// already overwritten by the time the composed run arrives. A plain run is the block write's to
// place, like any insertion (`insertion-route-parity`); the mode check lives in the block.
import { describe, it, expect } from 'vitest';
import { parseInline } from '#lib/core/inline/index.js';
import { createCompositionSeat } from '#lib/components/blocks/text/composition-seat.js';
import type { PendingMarks } from '#lib/caret/pending-marks.js';
import type { InlineMarkKind } from '#lib/schema/inline-construct-policy.js';
import { makePendingMarks } from '#lib/test/harness/editor-actions.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';

const BOLD = 'Some **bold** text';

interface Live {
	display: string;
	/** Kept at the parse from before the composition, as in production: commits are skipped
	 *  while one runs, so the component's live read still answers with the old tree. */
	inlines: ReturnType<typeof parseInline>;
	marks: ReadonlySet<InlineMarkKind> | null;
	range: { start: number; end: number } | null;
	rangeEdits: Array<{ range: { start: number; end: number }; typed: string }>;
}

function makeSeat(live: Live, pending?: PendingMarks) {
	return createCompositionSeat({
		getDisplayText: () => live.display,
		getInlines: () => live.inlines,
		reading: fixtureReading(),
		offsetFor: (caret) => caret,
		consumePendingMarks: () => pending?.consume() ?? live.marks,
		restorePendingMarks: (marks) => pending?.restore(marks),
		getRawSelection: () => live.range,
		resolveRangeEdit: (range, typed) => {
			live.rangeEdits.push({ range, typed });
			return { raw: `cleaned:${typed}`, caret: 1 };
		}
	});
}

function liveState(display: string): Live {
	return {
		display,
		inlines: parseInline(display, 0, display.length),
		marks: null,
		range: null,
		rangeEdits: []
	};
}

describe('the window is captured at noteStart, not read at the commit', () => {
	it('wraps against the display the composition opened at', () => {
		const live = liveState('hello');
		live.marks = new Set<InlineMarkKind>(['strong']);
		const seat = makeSeat(live);
		seat.noteStart();
		live.display = 'unrelated';
		expect(seat.relocate('helloかん', 5)).toEqual({ raw: 'hello**かん**', caret: 9 });
	});

	it('leaves a plain run to the write, which places it like any insertion', () => {
		const seat = makeSeat(liveState(BOLD));
		seat.noteStart();
		expect(seat.relocate('Some **boldかん** text', 11)).toBeNull();
	});

	it('answers null outside a window: before any start, and after noteEnd', () => {
		const live = liveState('hello');
		live.marks = new Set<InlineMarkKind>(['strong']);
		const seat = makeSeat(live);
		expect(seat.relocate('helloかん', 5)).toBeNull();
		seat.noteStart();
		seat.noteEnd();
		expect(seat.relocate('helloかん', 5)).toBeNull();
	});
});

describe('pending marks beat the arrival side', () => {
	it('wraps the composed run in the marks the caret chain lacks', () => {
		const live = liveState('hello');
		live.marks = new Set<InlineMarkKind>(['strong']);
		const seat = makeSeat(live);
		seat.noteStart();
		expect(seat.relocate('helloかん', 5)).toEqual({ raw: 'hello**かん**', caret: 9 });
	});
});

// Taking the marks at `compositionstart` spends them even when the composition never commits,
// so a cancelled IME run must hand them back for the next insertion.
describe('a composition that commits nothing returns the marks it took', () => {
	it('hands back a set no commit spent', () => {
		const live = liveState('hello');
		const pending = makePendingMarks('strong');
		const seat = makeSeat(live, pending);

		seat.noteStart();
		expect(pending.get()).toBeNull();
		seat.noteEnd();
		expect([...(pending.get() ?? [])]).toEqual(['strong']);
	});

	it('keeps a set the composition’s own commit spent', () => {
		const live = liveState('hello');
		const pending = makePendingMarks('strong');
		const seat = makeSeat(live, pending);

		seat.noteStart();
		expect(seat.relocate('helloかん', 5)).toEqual({ raw: 'hello**かん**', caret: 9 });
		seat.noteEnd();
		expect(pending.get()).toBeNull();
	});

	// A chord pressed while the IME was open is the newer instruction about the same caret.
	it('declines to overwrite a set pended during the composition', () => {
		const live = liveState('hello');
		const pending = makePendingMarks('strong');
		const seat = makeSeat(live, pending);

		seat.noteStart();
		pending.toggle('emphasis');
		seat.noteEnd();
		expect([...(pending.get() ?? [])]).toEqual(['emphasis']);
	});
});

describe('a selection captured at noteStart routes the commit to the join', () => {
	it('hands the join the range and the extracted run', () => {
		const live = liveState(BOLD);
		live.range = { start: 5, end: 13 };
		const seat = makeSeat(live);
		seat.noteStart();
		expect(seat.relocate('Some かん text', 5)).toEqual({ raw: 'cleaned:かん', caret: 1 });
		expect(live.rangeEdits).toEqual([{ range: { start: 5, end: 13 }, typed: 'かん' }]);
	});

	it('declines a read that is not a replacement of the captured range', () => {
		const live = liveState(BOLD);
		live.range = { start: 5, end: 13 };
		const seat = makeSeat(live);
		seat.noteStart();
		expect(seat.relocate('Xome かん text', 5)).toBeNull();
		expect(live.rangeEdits).toEqual([]);
	});
});
