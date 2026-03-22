import { describe, it, expect } from 'vitest';
import { parse } from '../core/parser';
import { toMutable, serializeMutable, cloneDocument } from '../mutable-tree';
import { createUndoManager } from '../undo-manager';
import type { UndoEntry } from '../editor-types';

function makeEntry(source: string, blockIndex = 0, offset = 0): UndoEntry {
    return {
        snapshot: toMutable(parse(source)),
        focusBlockIndex: blockIndex,
        focusOffset: offset
    };
}

describe('UndoManager', () => {
    it('starts with canUndo and canRedo as false', () => {
        const manager = createUndoManager();
        expect(manager.canUndo).toBe(false);
        expect(manager.canRedo).toBe(false);
    });

    it('can push and undo', () => {
        const manager = createUndoManager();
        const entry = makeEntry('Hello\n');
        manager.push(entry);
        expect(manager.canUndo).toBe(true);
        const restored = manager.undo();
        expect(restored).not.toBeNull();
        expect(serializeMutable(restored!.snapshot)).toBe('Hello\n');
    });

    it('undo returns entries in reverse order', () => {
        const manager = createUndoManager();
        manager.push(makeEntry('First\n'));
        manager.push(makeEntry('Second\n'));
        manager.push(makeEntry('Third\n'));
        const third = manager.undo();
        expect(serializeMutable(third!.snapshot)).toBe('Third\n');
        const second = manager.undo();
        expect(serializeMutable(second!.snapshot)).toBe('Second\n');
        const first = manager.undo();
        expect(serializeMutable(first!.snapshot)).toBe('First\n');
        expect(manager.undo()).toBeNull();
    });

    it('redo works after undo', () => {
        const manager = createUndoManager();
        manager.push(makeEntry('A\n'));
        manager.push(makeEntry('B\n'));
        manager.undo();
        expect(manager.canRedo).toBe(true);
        const redone = manager.redo();
        expect(serializeMutable(redone!.snapshot)).toBe('B\n');
    });

    it('new push after undo clears the redo stack', () => {
        const manager = createUndoManager();
        manager.push(makeEntry('A\n'));
        manager.push(makeEntry('B\n'));
        manager.undo();
        manager.push(makeEntry('C\n'));
        expect(manager.canRedo).toBe(false);
        expect(manager.redo()).toBeNull();
    });

    it('clear empties both stacks', () => {
        const manager = createUndoManager();
        manager.push(makeEntry('A\n'));
        manager.push(makeEntry('B\n'));
        manager.undo();
        manager.clear();
        expect(manager.canUndo).toBe(false);
        expect(manager.canRedo).toBe(false);
    });

    it('stores deep copies so mutations do not affect history', () => {
        const manager = createUndoManager();
        const entry = makeEntry('Hello\n');
        manager.push(entry);
        entry.snapshot.children[0].raw = 'Modified\n';
        const restored = manager.undo();
        expect(serializeMutable(restored!.snapshot)).toBe('Hello\n');
    });

    it('preserves focus info in undo entries', () => {
        const manager = createUndoManager();
        manager.push(makeEntry('Hello\n', 2, 15));
        const restored = manager.undo();
        expect(restored!.focusBlockIndex).toBe(2);
        expect(restored!.focusOffset).toBe(15);
    });
});
