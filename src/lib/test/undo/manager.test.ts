import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { assignIds } from '../../block-id';
import { createUndoManager } from '../../undo/manager';
import type { UndoEntry } from '../../undo/types';

function makeEntry(source: string, blockIndex = 0, offset = 0): UndoEntry {
	const snapshot = parse(source);
	const point = { path: [blockIndex], offset };
	return {
		snapshot,
		blockIds: assignIds(snapshot.children),
		selection: { anchor: point, focus: point }
	};
}

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
		manager.undo(makeEntry('After\n'));
		expect(manager.canRedo).toBe(true);
		const redone = manager.redo(makeEntry('Before\n'));
		expect(serialize(redone!.snapshot)).toBe('After\n');
	});

	it('peekUndo returns the top entry without consuming it', () => {
		const manager = createUndoManager();
		expect(manager.peekUndo()).toBeNull();
		manager.push(makeEntry('A\n'));
		manager.push(makeEntry('B\n'));
		expect(serialize(manager.peekUndo()!.snapshot)).toBe('B\n');
		expect(serialize(manager.peekUndo()!.snapshot)).toBe('B\n');
		manager.undo(CURRENT);
		expect(serialize(manager.peekUndo()!.snapshot)).toBe('A\n');
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
		// Regression guard: an eviction direction flip (pop vs shift) would make
		// the user's most recent edit unreachable.
		const manager = createUndoManager();
		const CAP = 200;
		for (let i = 0; i < CAP + 1; i++) {
			manager.push(makeEntry(`entry${i}\n`));
		}
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
		expect(serialize(last!.snapshot)).toBe('entry1\n');
		expect(manager.undo(current)).toBeNull();
	});

	it('full undo-redo-undo cycle', () => {
		const manager = createUndoManager();
		manager.push(makeEntry('\n'));
		manager.push(makeEntry('A\n'));
		const undone1 = manager.undo(makeEntry('AB\n'));
		expect(serialize(undone1!.snapshot)).toBe('A\n');
		const redone = manager.redo(makeEntry('A\n'));
		expect(serialize(redone!.snapshot)).toBe('AB\n');
		const undone2 = manager.undo(makeEntry('AB\n'));
		expect(serialize(undone2!.snapshot)).toBe('A\n');
		const undone3 = manager.undo(makeEntry('A\n'));
		expect(serialize(undone3!.snapshot)).toBe('\n');
	});

	it('restoreStacks restores both stacks to a captured snapshot', () => {
		const manager = createUndoManager();
		manager.push(makeEntry('A\n'));
		manager.undo(CURRENT); // undo=[], redo=[CURRENT]
		manager.push(makeEntry('B\n')); // push clears redo → undo=[B], redo=[]
		const saved = manager.getStacks(); // { undo:[B], redo:[] }
		manager.push(makeEntry('C\n')); // undo=[B,C], redo=[]
		manager.restoreStacks(saved); // back to undo=[B], redo=[]
		expect(serialize(manager.peekUndo()!.snapshot)).toBe('B\n');
		expect(manager.canRedo).toBe(false);
		manager.undo(CURRENT); // pops B
		expect(manager.canUndo).toBe(false);
	});

	it('restoreStacks recovers an entry evicted by an at-cap push', () => {
		const manager = createUndoManager();
		const CAP = 200;
		for (let i = 0; i < CAP; i++) manager.push(makeEntry(`e${i}\n`)); // full at cap
		const saved = manager.getStacks(); // undo holds e0..e199
		manager.push(makeEntry('overflow\n')); // evicts e0
		manager.restoreStacks(saved); // restores e0..e199
		let current = CURRENT;
		let last: UndoEntry | null = null;
		for (let i = 0; i < CAP; i++) {
			last = manager.undo(current);
			current = last!;
		}
		expect(serialize(last!.snapshot)).toBe('e0\n');
		expect(manager.canUndo).toBe(false);
	});
});
