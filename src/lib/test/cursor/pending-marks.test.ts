import { describe, it, expect } from 'vitest';
import {
	createEdgeAffinityState,
	type EdgeAffinityState,
	type EdgeAffinityAction
} from '../../cursor/edge-affinity';
import {
	createPendingMarksState,
	flipMark,
	type PendingMarksState
} from '../../cursor/pending-marks';
import type { InlineMarkKind } from '../../schema/inline-construct-policy';

// The set a collapsed-caret toggle promises the next insertion. Two properties carry the
// contract: exactly one insertion spends it, and every caret-invalidating seam drops it —
// the second by composition with the edge affinity rather than by a clear at each seam, so
// the seam list can never drift out of parity. Miss-analysis (lifecycle, not a bug fix): the
// column and the affinity are pinned only at their own doors, so a third rider needs its own
// matrix or its clearing is asserted nowhere.

const kinds = (marks: ReadonlySet<InlineMarkKind> | null): InlineMarkKind[] =>
	marks === null ? [] : [...marks].sort();

describe('flipMark', () => {
	it('adds a kind that is not pending and removes one that is', () => {
		const one = flipMark(null, 'strong');
		expect(kinds(one)).toEqual(['strong']);
		expect(kinds(flipMark(one, 'emphasis'))).toEqual(['emphasis', 'strong']);
		expect(kinds(flipMark(one, 'strong'))).toEqual([]);
	});

	// Null, not an empty set: a read is then the whole question, and no consumer has to
	// distinguish "nothing pending" from "pending nothing".
	it('empties to null rather than to an empty set', () => {
		expect(flipMark(flipMark(null, 'strong'), 'strong')).toBeNull();
	});

	it('does not mutate the set it was handed', () => {
		const one = flipMark(null, 'strong');
		flipMark(one, 'emphasis');
		expect(kinds(one)).toEqual(['strong']);
	});
});

describe('pending marks lifecycle', () => {
	it('starts empty and reports the kinds a toggle pends', () => {
		const marks = createPendingMarksState();
		expect(marks.get()).toBeNull();

		marks.toggle('strong');
		marks.toggle('emphasis');
		expect(kinds(marks.get())).toEqual(['emphasis', 'strong']);
	});

	it('exactly one insertion spends the set', () => {
		const marks = createPendingMarksState();
		marks.toggle('strong');

		expect(kinds(marks.consume())).toEqual(['strong']);
		expect(marks.consume()).toBeNull();
		expect(marks.get()).toBeNull();
	});

	it('reset drops the set without spending it anywhere', () => {
		const marks = createPendingMarksState();
		marks.toggle('strong');
		marks.reset();
		expect(marks.get()).toBeNull();
	});
});

// The clearing matrix is the affinity's invalidation matrix, by construction: the marks are
// composed onto the affinity at the editor root, so every seam that invalidates the arrival
// side drops the marks too. Driving it through the affinity is what pins that.
describe('pending marks clear with the caret side', () => {
	function composed(): { affinity: EdgeAffinityState; marks: PendingMarksState } {
		const marks = createPendingMarksState();
		const affinity = createEdgeAffinityState({ onInvalidate: marks.reset });
		return { affinity, marks };
	}

	function pended(): { affinity: EdgeAffinityState; marks: PendingMarksState } {
		const state = composed();
		state.marks.toggle('strong');
		return state;
	}

	it('a structural or lifecycle seam clears them through reset()', () => {
		const { affinity, marks } = pended();
		affinity.reset();
		expect(marks.get()).toBeNull();
	});

	it('a committed keystroke clears them through noteTyping()', () => {
		const { affinity, marks } = pended();
		affinity.noteTyping();
		expect(marks.get()).toBeNull();
	});

	// The whole point of riding `note`: the affinity only records a side there, but a caret
	// that MOVED is a caret the promise no longer applies to.
	const MOVED: Record<string, EdgeAffinityAction> = {
		ArrowLeft: 'far',
		ArrowRight: 'near',
		ArrowUp: 'far',
		ArrowDown: 'near',
		PageUp: 'far',
		PageDown: 'near',
		Home: 'outside',
		End: 'outside',
		Escape: 'reset',
		Enter: 'reset',
		Backspace: 'reset',
		Tab: 'reset'
	};
	for (const [key, action] of Object.entries(MOVED)) {
		it(`${key} (${action}) clears them`, () => {
			const { affinity, marks } = pended();
			affinity.note({ key, altKey: false });
			expect(marks.get()).toBeNull();
		});
	}

	// The chord that SETS them is a bare modifier followed by a letter, and the byte that
	// SPENDS them is a printable key — both must reach the seat with the promise intact.
	for (const key of ['Control', 'Meta', 'Shift', 'Alt', 'AltGraph', 'CapsLock', 'b', 'X', 'é']) {
		it(`${key} preserves them`, () => {
			const { affinity, marks } = pended();
			affinity.note({ key, altKey: false });
			expect(kinds(marks.get())).toEqual(['strong']);
		});
	}

	// Alt+Arrow is the block-reorder chord, so the affinity declines to classify it; the
	// reorder's own commit is what clears, exactly as it does for the side.
	it('Alt+ArrowUp preserves them, like the side it declines to classify', () => {
		const { affinity, marks } = pended();
		affinity.note({ key: 'ArrowUp', altKey: true });
		expect(kinds(marks.get())).toEqual(['strong']);
	});

	it('an affinity built without the composition leaves the marks alone', () => {
		const marks = createPendingMarksState();
		marks.toggle('strong');
		createEdgeAffinityState().reset();
		expect(kinds(marks.get())).toEqual(['strong']);
	});
});
