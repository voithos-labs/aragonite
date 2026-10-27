/**
 * Undo/redo state model: the snapshot entry a manager stores and the
 * manager interface the editor controller talks to.
 */

import type { Document } from '../core/nodes';
import type { GapCaretSelection } from '../selection/gap-caret';
import type { EditorSelection } from '../selection/primitives';

export interface UndoEntry {
	snapshot: Document;
	blockIds: string[];
	/** Effective selection at push (`docs/design/commit-and-undo.md` § Undo / redo). */
	selection: EditorSelection | GapCaretSelection;
	/** Dev-only digest of `snapshot` at push; restore verifies no mutation wrote through a shared node. */
	integrity?: number;
}

/** The document an undo or redo would replace; `version` changes whenever its bytes do. */
export interface LiveDocument {
	doc(): Document;
	version(): number;
}

export interface UndoManager {
	push(entry: UndoEntry): void;
	/** Top undo entry without the per-call stack copies of getStacks. */
	peekUndo(): UndoEntry | null;
	undo(currentState: UndoEntry): UndoEntry | null;
	redo(currentState: UndoEntry): UndoEntry | null;
	clear(): void;
	/** Snapshots of both stacks for inspection. */
	getStacks(): { undo: UndoEntry[]; redo: UndoEntry[] };
	/** Restore both stacks from a `getStacks()` snapshot. Wholesale, not a pop, because
	 *  `push` may have evicted the oldest entry at MAX_UNDO. */
	restoreStacks(stacks: { undo: UndoEntry[]; redo: UndoEntry[] }): void;
	/** Whether an undo would change the document: an entry that wouldn't is no step. */
	readonly canUndo: boolean;
	readonly canRedo: boolean;
}
