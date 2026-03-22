/**
 * Snapshot-based undo/redo stack.
 * Stores deep clones of CST documents.
 */

import type { UndoManager, UndoEntry } from './editor-types';
import { cloneDocument } from './mutable-tree';

export function createUndoManager(): UndoManager {
    const undoStack: UndoEntry[] = [];
    const redoStack: UndoEntry[] = [];

    function cloneEntry(entry: UndoEntry): UndoEntry {
        return {
            snapshot: cloneDocument(entry.snapshot),
            focusBlockIndex: entry.focusBlockIndex,
            focusOffset: entry.focusOffset
        };
    }

    return {
        push(entry: UndoEntry): void {
            undoStack.push(cloneEntry(entry));
            redoStack.length = 0;
        },

        undo(): UndoEntry | null {
            const entry = undoStack.pop();
            if (!entry) return null;
            redoStack.push(entry);
            return cloneEntry(entry);
        },

        redo(): UndoEntry | null {
            const entry = redoStack.pop();
            if (!entry) return null;
            undoStack.push(entry);
            return cloneEntry(entry);
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
