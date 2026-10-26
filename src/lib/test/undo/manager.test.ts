import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { assignIds } from '../../block-id';
import { createUndoManager as createManager } from '../../undo/manager';
import { rangeSelectionOf } from '../support/undo-entry';
import type { UndoEntry } from '../../undo/types';
import type { Document } from '../../core/nodes';

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

/** The document an undo would replace, moved by hand here, its version bumped with each move. */
function liveDocument(source = 'live\n') {
	let doc = parse(source);
	let version = 0;
	const reads = { count: 0 };
	return {
		reads,
		live: {
			doc: () => {
				reads.count++;
				return doc;
			},
			version: () => version
		},
		set(next: Document) {
			doc = next;
			version++;
		}
	};
}

const createUndoManager = (live = liveDocument().live) => createManager(live);

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
		expect(rangeSelectionOf(restored!).anchor.path).toEqual([2]);
		expect(rangeSelectionOf(restored!).anchor.offset).toBe(15);
		expect(rangeSelectionOf(restored!).focus.path).toEqual([2]);
		expect(rangeSelectionOf(restored!).focus.offset).toBe(15);
	});

	it('evicts the oldest entry once the stack exceeds MAX_UNDO (FIFO)', () => {
		// Regression check: dropping from the wrong end (`pop` instead of `shift`) would make the
		// user's most recent edit unreachable.
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

// Miss-analysis: every suite pushed entries that each changed the document, never one that left it
// as it was, so a typing run that deleted what it typed still read as a step.
describe('an entry that would leave the document as it is', () => {
	it('is no step to undo, so a stack holding only those has nothing to undo', () => {
		const manager = createUndoManager(liveDocument('same\n').live);
		manager.push(makeEntry('same\n'));
		expect(manager.canUndo).toBe(false);
		expect(manager.undo(CURRENT)).toBeNull();
	});

	it('is passed over, so one undo reaches the step below it', () => {
		const manager = createUndoManager(liveDocument('same\n').live);
		manager.push(makeEntry('before\n'));
		manager.push(makeEntry('same\n'));
		expect(manager.canUndo).toBe(true);
		expect(serialize(manager.undo(CURRENT)!.snapshot)).toBe('before\n');
		expect(manager.canUndo).toBe(false);
	});

	it('is no step to redo either', () => {
		const holder = liveDocument('a\n');
		const manager = createUndoManager(holder.live);
		manager.push(makeEntry('before\n'));
		manager.undo(makeEntry('a\n'));
		holder.set(parse('a\n'));
		expect(manager.canRedo).toBe(false);
		expect(manager.redo(CURRENT)).toBeNull();
	});

	it('reads the document once per content version, however often a toolbar asks', () => {
		const holder = liveDocument('x\n');
		const manager = createUndoManager(holder.live);
		manager.push(makeEntry('before\n'));
		expect(manager.canUndo).toBe(true);
		const reads = holder.reads.count;
		for (let i = 0; i < 5; i++) expect(manager.canUndo).toBe(true);
		expect(holder.reads.count).toBe(reads);
		holder.set(parse('before\n'));
		expect(manager.canUndo).toBe(false);
	});
});
