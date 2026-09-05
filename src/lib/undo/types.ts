/**
 * Undo/redo state model: the snapshot entry a manager stores and the
 * manager interface the editor controller talks to.
 */

import type { Document } from '../core/nodes';
import type { GapCaretPosition } from '../selection/gap-caret';
import type { EditorSelection } from '../selection/primitives';

/**
 * A gap caret at push. Its own type, never a member of `EditorSelection`: the gap is
 * collapsed-only and can never be a cross-block endpoint.
 */
export interface GapCaretSelection {
	gapCaret: GapCaretPosition;
}

export function isGapSelection(
	selection: EditorSelection | GapCaretSelection
): selection is GapCaretSelection {
	return 'gapCaret' in selection;
}

export interface UndoEntry {
	snapshot: Document;
	blockIds: string[];
	/** Effective selection at push. See docs/design/editor.md § Undo / redo. */
	selection: EditorSelection | GapCaretSelection;
	/** DEV-only digest of `snapshot` at push; restore verifies no mutation wrote through a shared node. */
	integrity?: number;
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
	readonly canUndo: boolean;
	readonly canRedo: boolean;
}
