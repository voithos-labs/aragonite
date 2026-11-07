import { describe, it, expect } from 'vitest';
import { createCaretMemory, type CaretMemory } from '../../caret/caret-memory';
import type { CaretKeyAction } from '../../caret/edge-affinity';
import type { InsertionPlacement, TextEdit } from '../../caret/next-insertion';
import { flipMark } from '../../caret/pending-marks';
import type { InlineMarkKind } from '../../schema/inline-construct-policy';
import { marksPending, pendMark } from '../harness/pending-marks';

// The marks a toggle with no selection promises the next insertion in its block: exactly one
// insertion uses them up, and anything that moves the caret drops them along with the column and
// the side.
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
		pendMark(memory);
		return memory;
	}

	it('a caret move that is not a key clears them through forget()', () => {
		const memory = pended();
		memory.forget();
		expect(marksPending(memory)).toBe(false);
	});

	it('a committed keystroke clears them through noteTyping()', () => {
		const memory = pended();
		memory.noteTyping();
		expect(marksPending(memory)).toBe(false);
	});

	// One key per action class: the per-key table is `classifyCaretKey`'s, held in edge-affinity.test.ts.
	const MOVED: Record<string, CaretKeyAction> = { ArrowLeft: 'navigate', Enter: 'reset' };
	for (const [key, action] of Object.entries(MOVED)) {
		it(`${key} (${action}) clears them`, () => {
			const memory = pended();
			memory.noteKey({ key }, null);
			expect(marksPending(memory)).toBe(false);
		});
	}

	// The chord that sets them is a modifier plus a letter, and the byte that uses them up is a
	// printable key; both have to reach the write with the promise intact.
	for (const key of ['Control', 'b']) {
		it(`${key} preserves them`, () => {
			const memory = pended();
			memory.noteKey({ key }, null);
			expect(marksPending(memory)).toBe(true);
		});
	}

	// A reorder moves the block, not the caret; the reorder's own commit is what clears.
	it('a block move preserves them, like the side it leaves alone', () => {
		const memory = pended();
		memory.noteKey({ key: 'ArrowUp' }, 'block.moveUp');
		expect(marksPending(memory)).toBe(true);
	});
});

// A stand-in block that wraps an insertion in each mark's first letter, so the spend is visible.
const PLACEMENT: InsertionPlacement = {
	place: () => null,
	mark: (before, edit, at, marks) => {
		const tag = [...marks].map((kind) => kind[0]).join('');
		const typed = edit.text.slice(at, at + edit.text.length - before.length);
		const text = before.slice(0, at) + tag + typed + tag + before.slice(at);
		return { text, caretAfter: at + tag.length + typed.length };
	}
};

const typed = (before: string, at: number, text: string): TextEdit => ({
	text: before.slice(0, at) + text + before.slice(at),
	caretAfter: at + text.length
});

describe('the next insertion in the block spends them', () => {
	it('once: the insertion is marked, and the one after it is not', () => {
		const memory = createCaretMemory();
		const block = {};
		memory.pendingMarks.forBlock(block).toggle('strong');

		const first = memory.holdInsertion(block, PLACEMENT);
		expect(first.spend('ab', typed('ab', 2, 'X'))).toEqual({ text: 'absXs', caretAfter: 4 });
		first.finish(true);

		const second = memory.holdInsertion(block, PLACEMENT);
		expect(second.spend('ab', typed('ab', 2, 'X')).text).toBe('abX');
		second.finish(true);
	});

	// An IME cancel writes nothing, so the promise is still owed.
	it('a write that changed nothing leaves them pending', () => {
		const memory = createCaretMemory();
		const block = {};
		memory.pendingMarks.forBlock(block).toggle('strong');

		memory.holdInsertion(block, PLACEMENT).finish(false);

		expect(memory.holdInsertion(block, PLACEMENT).spend('ab', typed('ab', 2, 'X')).text).toBe(
			'absXs'
		);
	});

	// The set a write holds is that write's to spend, so a chord meanwhile is a newer instruction.
	it('a chord while a write holds them starts a set of its own', () => {
		const memory = createCaretMemory();
		const block = {};
		memory.pendingMarks.forBlock(block).toggle('strong');
		const held = memory.holdInsertion(block, PLACEMENT);

		memory.pendingMarks.forBlock(block).toggle('emphasis');
		expect(held.spend('ab', typed('ab', 2, 'X')).text).toBe('absXs');
		held.finish(true);

		const next = memory.holdInsertion(block, PLACEMENT);
		expect(next.spend('ab', typed('ab', 2, 'X')).text).toBe('abeXe');
	});

	// Miss-analysis: the row above pressed one chord during the hold, so the second press, which
	// has to cancel the set the first started rather than start another, was never met.
	it('a second chord while the write holds them cancels the set the first one started', () => {
		const memory = createCaretMemory();
		const block = {};
		memory.pendingMarks.forBlock(block).toggle('strong');
		const held = memory.holdInsertion(block, PLACEMENT);

		memory.pendingMarks.forBlock(block).toggle('emphasis');
		memory.pendingMarks.forBlock(block).toggle('emphasis');
		expect(held.spend('ab', typed('ab', 2, 'X')).text).toBe('absXs');
		held.finish(true);

		expect(memory.holdInsertion(block, PLACEMENT).waitsAt(0)).toBe(false);
	});

	it('another block’s insertion types plain and leaves them pending', () => {
		const memory = createCaretMemory();
		const block = {};
		memory.pendingMarks.forBlock(block).toggle('strong');

		const elsewhere = memory.holdInsertion({}, PLACEMENT);
		expect(elsewhere.spend('ab', typed('ab', 2, 'X')).text).toBe('abX');
		elsewhere.finish(true);

		expect(memory.holdInsertion(block, PLACEMENT).waitsAt(0)).toBe(true);
	});

	// The auto-pair writes its delimiters where the caret means; a mark has nothing to wrap there.
	it('a write that placed its own bytes spends them unmarked', () => {
		const memory = createCaretMemory();
		const block = {};
		memory.pendingMarks.forBlock(block).toggle('strong');

		const held = memory.holdInsertion(block, PLACEMENT);
		expect(held.spendInPlace('ab', typed('ab', 2, '**')).text).toBe('ab**');
		held.finish(true);

		expect(memory.holdInsertion(block, PLACEMENT).waitsAt(0)).toBe(false);
	});
});
