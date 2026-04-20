/**
 * Snapshot-based undo/redo stack.
 * Stores deep clones of CST documents.
 */

import type { UndoManager, UndoEntry } from './contracts';

const MAX_UNDO = 200;

export function createUndoManager(): UndoManager {
	const undoStack: UndoEntry[] = [];
	const redoStack: UndoEntry[] = [];

	return {
		push(entry: UndoEntry): void {
			// Caller is responsible for cloning before push
			undoStack.push(entry);
			if (undoStack.length > MAX_UNDO) undoStack.shift();
			redoStack.length = 0;
		},

		undo(currentState: UndoEntry): UndoEntry | null {
			const entry = undoStack.pop();
			if (!entry) return null;
			// Save current state to redo so the user can redo back to it
			redoStack.push(currentState);
			return entry;
		},

		redo(currentState: UndoEntry): UndoEntry | null {
			const entry = redoStack.pop();
			if (!entry) return null;
			// Save current state to undo so the user can undo back to it
			undoStack.push(currentState);
			return entry;
		},

		clear(): void {
			undoStack.length = 0;
			redoStack.length = 0;
		},

		getStacks() {
			return { undo: [...undoStack], redo: [...redoStack] };
		},

		get canUndo(): boolean {
			return undoStack.length > 0;
		},

		get canRedo(): boolean {
			return redoStack.length > 0;
		}
	};
}
