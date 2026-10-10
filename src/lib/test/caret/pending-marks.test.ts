import { describe, it, expect } from 'vitest';
import { createCaretMemory, type CaretMemory } from '../../caret/caret-memory';
import type { CaretKeyAction } from '../../caret/edge-affinity';
import { flipMark } from '../../caret/pending-marks';
import type { InlineMarkKind } from '../../schema/inline-construct-policy';

// The marks a toggle with no selection promises the next insertion: exactly one insertion uses
// them up, and anything that moves the caret drops them along with the column and the side.
// Miss-analysis: the column and side were tested only where set, so nothing asserted a clear.

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

// Everything that decides which side the caret arrived on drops the marks too, so the arrival
// table is the table of what clears them; driving it through the memory tests that.
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

	// A caret that moved, or a key that changed the text another way, is a caret the promise no
	// longer applies to.
	const MOVED: Record<string, CaretKeyAction> = {
		ArrowLeft: 'navigate',
		ArrowRight: 'navigate',
		ArrowUp: 'navigate',
		ArrowDown: 'navigate',
		PageUp: 'navigate',
		PageDown: 'navigate',
		Home: 'navigate',
		End: 'navigate',
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
