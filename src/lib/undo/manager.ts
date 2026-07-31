import type { UndoManager, UndoEntry } from './types';

const MAX_UNDO = 200;

export function createUndoManager(): UndoManager {
	const undoStack: UndoEntry[] = [];
	const redoStack: UndoEntry[] = [];

	return {
		push(entry: UndoEntry): void {
			// Stored as-is: the caller builds entries safe to hold.
			undoStack.push(entry);
			if (undoStack.length > MAX_UNDO) undoStack.shift();
			redoStack.length = 0;
		},

		peekUndo(): UndoEntry | null {
			return undoStack[undoStack.length - 1] ?? null;
		},

		undo(currentState: UndoEntry): UndoEntry | null {
			const entry = undoStack.pop();
			if (!entry) return null;
			redoStack.push(currentState);
			return entry;
		},

		redo(currentState: UndoEntry): UndoEntry | null {
			const entry = redoStack.pop();
			if (!entry) return null;
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

		restoreStacks(stacks: { undo: UndoEntry[]; redo: UndoEntry[] }): void {
			undoStack.length = 0;
			undoStack.push(...stacks.undo);
			redoStack.length = 0;
			redoStack.push(...stacks.redo);
		},

		get canUndo(): boolean {
			return undoStack.length > 0;
		},

		get canRedo(): boolean {
			return redoStack.length > 0;
		}
	};
}
