import { describe, it, expect } from 'vitest';
import { createCaretMemory, type CaretMemory } from '../../cursor/caret-memory';
import type { EdgeAffinityAction } from '../../cursor/edge-affinity';
import { flipMark } from '../../cursor/pending-marks';
import type { InlineMarkKind } from '../../schema/inline-construct-policy';

// The marks a toggle with no selection promises the next insertion. Two properties carry the
// contract: exactly one insertion uses them up, and everything that moves the caret drops
// them. The second holds because they live in the caret memory with the column and the side,
// so nothing can drop one without the others. Miss-analysis (a lifecycle gap, not a bug fix):
// the sticky column and the affinity are tested only where they are set, so a third rider needs
// its own table or nothing asserts that it is cleared.

const kinds = (marks: ReadonlySet<InlineMarkKind> | null): InlineMarkKind[] =>
	marks === null ? [] : [...marks].sort();

describe('flipMark', () => {
	it('adds a kind that is not pending and removes one that is', () => {
		const one = flipMark(null, 'strong');
		expect(kinds(one)).toEqual(['strong']);
		expect(kinds(flipMark(one, 'emphasis'))).toEqual(['emphasis', 'strong']);
		expect(kinds(flipMark(one, 'strong'))).toEqual([]);
	});

	// Null, not an empty set, so one read answers the whole question and no caller has to tell
	// "nothing pending" from "pending nothing".
	it('empties to null rather than to an empty set', () => {
		expect(flipMark(flipMark(null, 'strong'), 'strong')).toBeNull();
	});

	it('does not mutate the set it was handed', () => {
		const one = flipMark(null, 'strong');
		flipMark(one, 'emphasis');
		expect(kinds(one)).toEqual(['strong']);
	});
});

// Everything that settles which side the caret arrived on drops the marks too, so the table of
// what clears them is the arrival table. Driving it through the memory is what tests that.
describe('pending marks clear with the caret side', () => {
	function pended(): CaretMemory {
		const memory = createCaretMemory();
		memory.pendingMarks.toggle('strong');
		return memory;
	}

	it('a caret move that is not a key clears them through forget()', () => {
		const memory = pended();
		memory.forget();
		expect(memory.pendingMarks.get()).toBeNull();
	});

	it('a committed keystroke clears them through noteTyping()', () => {
		const memory = pended();
		memory.noteTyping();
		expect(memory.pendingMarks.get()).toBeNull();
	});

	// The memory only records a side for these, but a caret that moved is a caret the promise no
	// longer applies to.
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
			const memory = pended();
			memory.noteKey({ key }, null);
			expect(memory.pendingMarks.get()).toBeNull();
		});
	}

	// The chord that sets them is a modifier plus a letter, and the byte that uses them up is a
	// printable key; both have to reach the write with the promise intact.
	for (const key of ['Control', 'Meta', 'Shift', 'Alt', 'AltGraph', 'CapsLock', 'b', 'X', 'é']) {
		it(`${key} preserves them`, () => {
			const memory = pended();
			memory.noteKey({ key }, null);
			expect(kinds(memory.pendingMarks.get())).toEqual(['strong']);
		});
	}

	// A reorder moves the block, not the caret; the reorder's own commit is what clears.
	it('a block move preserves them, like the side it leaves alone', () => {
		const memory = pended();
		memory.noteKey({ key: 'ArrowUp' }, 'block.moveUp');
		expect(kinds(memory.pendingMarks.get())).toEqual(['strong']);
	});
});
