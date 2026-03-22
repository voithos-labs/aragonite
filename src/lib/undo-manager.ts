/**
 * Snapshot-based undo/redo stack.
 * Stores deep clones of CST documents.
 */

import type { UndoManager, UndoEntry } from './editor-types';
import { cloneDocument } from './mutable-tree';

const MAX_UNDO = 200;

export function createUndoManager(): UndoManager {
    const undoStack: UndoEntry[] = [];
    const redoStack: UndoEntry[] = [];

    function cloneEntry(entry: UndoEntry): UndoEntry {
        return {
            snapshot: cloneDocument(entry.snapshot),
            blockIds: [...entry.blockIds],
            focusBlockIndex: entry.focusBlockIndex,
            focusOffset: entry.focusOffset
        };
    }

    return {
        push(entry: UndoEntry): void {
            // Caller is responsible for cloning before push
            undoStack.push(entry);
            if (undoStack.length > MAX_UNDO) undoStack.shift();
            redoStack.length = 0;
        },

        undo(): UndoEntry | null {
            const entry = undoStack.pop();
            if (!entry) return null;
            redoStack.push(cloneEntry(entry));
            return entry;
        },

        redo(): UndoEntry | null {
            const entry = redoStack.pop();
            if (!entry) return null;
            undoStack.push(cloneEntry(entry));
            return entry;
        },

        clear(): void {
            undoStack.length = 0;
            redoStack.length = 0;
        },

        get canUndo(): boolean {
            return undoStack.length > 0;
        },

        get canRedo(): boolean {
            return redoStack.length > 0;
        }
    };
}
