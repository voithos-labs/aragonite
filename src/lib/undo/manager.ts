/**
 * The undo and redo stacks. An entry is a step only while installing it would change the live
 * document's bytes; the manager passes over the rest, so a typing run that deleted what it typed,
 * or a write of the bytes already there, never reads as something to undo.
 */

import type { Document } from '../core/nodes';
import type { LiveDocument, UndoManager, UndoEntry } from './types';

const MAX_UNDO = 200;

export function createUndoManager(live: LiveDocument): UndoManager {
	const undoStack: UndoEntry[] = [];
	const redoStack: UndoEntry[] = [];
	// A verdict holds until the live bytes change, which bumps the version.
	const verdicts = new WeakMap<UndoEntry, { version: number; changes: boolean }>();

	function changesDocument(entry: UndoEntry): boolean {
		const version = live.version();
		const known = verdicts.get(entry);
		if (known?.version === version) return known.changes;
		const changes = !sameBytes(entry.snapshot, live.doc());
		verdicts.set(entry, { version, changes });
		return changes;
	}

	function hasStep(stack: UndoEntry[]): boolean {
		for (let i = stack.length - 1; i >= 0; i--) if (changesDocument(stack[i])) return true;
		return false;
	}

	/** Drops the entries on top that change nothing, then pops the step under them. */
	function popStep(stack: UndoEntry[]): UndoEntry | null {
		while (stack.length > 0 && !changesDocument(stack[stack.length - 1])) stack.pop();
		return stack.pop() ?? null;
	}

	return {
		push(entry: UndoEntry): void {
			// Stored as is: the caller builds entries that are safe to keep.
			undoStack.push(entry);
			if (undoStack.length > MAX_UNDO) undoStack.shift();
			redoStack.length = 0;
		},

		peekUndo(): UndoEntry | null {
			return undoStack[undoStack.length - 1] ?? null;
		},

		undo(currentState: UndoEntry): UndoEntry | null {
			const entry = popStep(undoStack);
			if (!entry) return null;
			redoStack.push(currentState);
			return entry;
		},

		redo(currentState: UndoEntry): UndoEntry | null {
			const entry = popStep(redoStack);
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
			return hasStep(undoStack);
		},

		get canRedo(): boolean {
			return hasStep(redoStack);
		}
	};
}

// A snapshot shares every top-level block it didn't write with the live tree, so only the blocks
// that differ by identity have their bytes compared.
function sameBytes(a: Document, b: Document): boolean {
	if (a.prefix !== b.prefix || a.suffix !== b.suffix) return false;
	if (a.children.length !== b.children.length) return false;
	for (let i = 0; i < a.children.length; i++) {
		const x = a.children[i];
		const y = b.children[i];
		if (x !== y && (x.leadingTrivia !== y.leadingTrivia || x.raw !== y.raw)) return false;
	}
	return true;
}
