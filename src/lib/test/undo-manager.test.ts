import { describe, it, expect } from 'vitest';
import { parse } from '../core/parser';
import { serialize } from '../core/serializer';
import { assignIds } from '../tree-operations/block-id';
import { createUndoManager } from '../undo-manager';
import type { UndoEntry } from '../contracts';

function makeEntry(source: string, blockIndex = 0, offset = 0): UndoEntry {
	const snapshot = parse(source);
	const point = { path: [blockIndex], offset };
	return {
		snapshot,
		blockIds: assignIds(snapshot.children),
		selection: { anchor: point, focus: point }
	};
}

// Dummy "current state" for undo/redo calls
const CURRENT = makeEntry('current\n');

describe('UndoManager', () => {
	it('starts with canUndo and canRedo as false', () => {
		const manager = createUndoManager();
		expect(manager.canUndo).toBe(false);
		expect(manager.canRedo).toBe(false);
	});

	it('can push and undo', () => {
		const manager = createUndoManager();
		manager.push(makeEntry('Hello\n'));
		expect(manager.canUndo).toBe(true);
		const restored = manager.undo(CURRENT);
		expect(restored).not.toBeNull();
		expect(serialize(restored!.snapshot)).toBe('Hello\n');
	});

	it('undo returns entries in reverse order', () => {
		const manager = createUndoManager();
		manager.push(makeEntry('First\n'));
		manager.push(makeEntry('Second\n'));
		manager.push(makeEntry('Third\n'));
		const third = manager.undo(CURRENT);
		expect(serialize(third!.snapshot)).toBe('Third\n');
		const second = manager.undo(makeEntry('after-third\n'));
		expect(serialize(second!.snapshot)).toBe('Second\n');
		const first = manager.undo(makeEntry('after-second\n'));
		expect(serialize(first!.snapshot)).toBe('First\n');
		expect(manager.undo(CURRENT)).toBeNull();
	});

	it('redo restores the current state that was passed to undo', () => {
		const manager = createUndoManager();
		manager.push(makeEntry('Before\n'));
		// Undo, passing current state "After\n"
		manager.undo(makeEntry('After\n'));
		expect(manager.canRedo).toBe(true);
		// Redo should give back "After\n" (the state we were at when we undid)
		const redone = manager.redo(makeEntry('Before\n'));
		expect(serialize(redone!.snapshot)).toBe('After\n');
	});

	it('new push after undo clears the redo stack', () => {
		const manager = createUndoManager();
		manager.push(makeEntry('A\n'));
		manager.push(makeEntry('B\n'));
		manager.undo(CURRENT);
		manager.push(makeEntry('C\n'));
		expect(manager.canRedo).toBe(false);
		expect(manager.redo(CURRENT)).toBeNull();
	});

	it('clear empties both stacks', () => {
		const manager = createUndoManager();
		manager.push(makeEntry('A\n'));
		manager.push(makeEntry('B\n'));
		manager.undo(CURRENT);
		manager.clear();
		expect(manager.canUndo).toBe(false);
		expect(manager.canRedo).toBe(false);
	});

	it('preserves focus info in undo entries', () => {
		const manager = createUndoManager();
		manager.push(makeEntry('Hello\n', 2, 15));
		const restored = manager.undo(CURRENT);
		expect(restored!.selection.anchor.path).toEqual([2]);
		expect(restored!.selection.anchor.offset).toBe(15);
		expect(restored!.selection.focus.path).toEqual([2]);
		expect(restored!.selection.focus.offset).toBe(15);
	});

	it('evicts the oldest entry once the stack exceeds MAX_UNDO (FIFO)', () => {
		// MAX_UNDO = 200 inside undo-manager.ts. Pushing one past the cap
		// should drop the OLDEST entry, not the newest — oldest-out FIFO so
		// the most recent edits are always recoverable. A bug that flipped
		// the eviction direction (shift vs pop) would keep the user's most
		// recent edit unreachable.
		const manager = createUndoManager();
		const CAP = 200;
		for (let i = 0; i < CAP + 1; i++) {
			manager.push(makeEntry(`entry${i}\n`));
		}
		// Undo CAP times — the first entry ("entry0") should already be gone.
		// The most-recent kept entry is "entry200" (the one we pushed last).
		const mostRecent = manager.undo(CURRENT);
		expect(serialize(mostRecent!.snapshot)).toBe(`entry${CAP}\n`);

		let current = CURRENT;
		let last: UndoEntry | null = null;
		for (let i = 0; i < CAP - 1; i++) {
			const next = manager.undo(current);
			expect(next).not.toBeNull();
			last = next;
			current = next!;
		}
		// The deepest surviving entry is "entry1" (entry0 was evicted).
		expect(serialize(last!.snapshot)).toBe('entry1\n');
		// Stack exhausted.
		expect(manager.undo(current)).toBeNull();
	});

	it('full undo-redo-undo cycle', () => {
		const manager = createUndoManager();
		// State progression: empty → "A" → "AB"
		manager.push(makeEntry('\n')); // checkpoint: empty
		manager.push(makeEntry('A\n')); // checkpoint: "A"
		// Current state is "AB". Undo should restore "A".
		const undone1 = manager.undo(makeEntry('AB\n'));
		expect(serialize(undone1!.snapshot)).toBe('A\n');
		// Redo should restore "AB"
		const redone = manager.redo(makeEntry('A\n'));
		expect(serialize(redone!.snapshot)).toBe('AB\n');
		// Undo again should restore "A"
		const undone2 = manager.undo(makeEntry('AB\n'));
		expect(serialize(undone2!.snapshot)).toBe('A\n');
		// Undo again should restore empty
		const undone3 = manager.undo(makeEntry('A\n'));
		expect(serialize(undone3!.snapshot)).toBe('\n');
	});
});
