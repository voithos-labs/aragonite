/**
 * Undo/redo state model: the snapshot entry a manager stores and the
 * manager interface the editor controller talks to. Re-exports
 * EditorSelection so callers reading UndoEntry get its selection type
 * from the same module.
 */

import type { Document } from './core/nodes';
import type { EditorSelection } from './selection/primitives';

export type { EditorSelection } from './selection/primitives';

export interface UndoEntry {
	snapshot: Document;
	blockIds: string[];
	/** Effective selection at push. See docs/design/editor/editor.md — Undo/Redo. */
	selection: EditorSelection;
}

export interface UndoManager {
	push(entry: UndoEntry): void;
	undo(currentState: UndoEntry): UndoEntry | null;
	redo(currentState: UndoEntry): UndoEntry | null;
	clear(): void;
	/** Snapshots of both stacks for inspection. */
	getStacks(): { undo: UndoEntry[]; redo: UndoEntry[] };
	readonly canUndo: boolean;
	readonly canRedo: boolean;
}
