// @vitest-environment jsdom
// What one composition captures, from `noteStart` to the commit: the values the commit itself has
// already overwritten by the time the composed run arrives. Where that run moves to is
// `edge-seat`'s suite; the mode check lives in the block (`editable-surface-composition-seat`).
import { describe, it, expect } from 'vitest';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { parseInline } from '$lib/core/inline';
import { createCompositionSeat } from '$lib/components/blocks/text/composition-seat';
import { screenVisibility } from '$lib/core/inline/visibility';
import type { PendingMarksState } from '$lib/cursor/pending-marks';
import type { InlineMarkKind } from '$lib/schema/inline-construct-policy';
import type { EdgeAffinity } from '$lib/cursor/edge-affinity';
import { makePendingMarks } from '$lib/test/harness/editor-actions';

const BOLD = 'Some **bold** text';

interface Live {
	display: string;
	/** Kept at the parse from before the composition, as in production: commits are skipped
	 *  while one runs, so the component's live read still answers with the old tree. */
	inlines: ReturnType<typeof parseInline>;
	affinity: EdgeAffinity | null;
	marks: ReadonlySet<InlineMarkKind> | null;
	range: { start: number; end: number } | null;
	rangeEdits: Array<{ range: { start: number; end: number }; typed: string }>;
}

function makeSeat(live: Live, pending?: PendingMarksState) {
	return createCompositionSeat({
		getDisplayText: () => live.display,
		getInlines: () => live.inlines,
		grammar: defaultGrammarView,
		getAffinity: () => live.affinity,
		getScreen: () => screenVisibility('live', { chromePaints: false }),
		consumePendingMarks: () => pending?.consume() ?? live.marks,
		restorePendingMarks: (marks) => pending?.restore(marks),
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
		// The block's own `compositionstart` resets the arrival side, and the DOM moves too.
		live.affinity = 'near';
		live.display = 'unrelated';
		expect(seat.relocate('Some **boldかん** text', 11)).toEqual({
			raw: 'Some **bold**かん text',
			caret: 15
		});
	});

	it('answers null outside a window: before any start, and after noteEnd', () => {
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

// The capture takes the marks at `compositionstart`, which spends them whether or not the
// composition ever commits. A cancelled IME run inserts nothing, so what the toggle promised is
// still due to the next insertion.
describe('a composition that commits nothing returns the marks it took', () => {
	it('hands back a set no commit spent', () => {
		const live = liveState('hello', 'far');
		const pending = makePendingMarks('strong');
		const seat = makeSeat(live, pending);

		seat.noteStart();
		expect(pending.get()).toBeNull();
		seat.noteEnd();
		expect([...(pending.get() ?? [])]).toEqual(['strong']);
	});

	it('keeps a set the composition’s own commit spent', () => {
		const live = liveState('hello', 'far');
		const pending = makePendingMarks('strong');
		const seat = makeSeat(live, pending);

		seat.noteStart();
		expect(seat.relocate('helloかん', 5)).toEqual({ raw: 'hello**かん**', caret: 9 });
		seat.noteEnd();
		expect(pending.get()).toBeNull();
	});

	// A chord pressed while the IME was open is the newer instruction about the same caret.
	it('declines to overwrite a set pended during the composition', () => {
		const live = liveState('hello', 'far');
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
