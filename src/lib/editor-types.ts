/**
 * Interfaces for the block editor system.
 * See docs/design/editor/editor.md for the design spec.
 */

import type { CstNode, Document } from './core/nodes';
import type { EditorSelection } from './selection/selection-types';
import type { StickyColumnDirection } from './context-keys';

// Re-export everything from context-keys so existing consumers don't break.
export * from './context-keys';

// Re-export CstNode and Document so consumers can import from here
export type { CstNode, Document } from './core/nodes';

// Re-export selection types so consumers can import from a single place.
export type {
	SelectionPoint,
	EditorSelection,
	SelectionDragStart
} from './selection/selection-types';

/** Sentinel offset meaning "place cursor at end of content". focus() clamps to content length. */
export const CURSOR_END = 999999;

/**
 * Sentinel offset meaning "focus the last descendant at its start."
 * Used after indent: cascade through containers choosing the last child at each
 * level, but when the leaf is reached, place the cursor at offset 0.
 */
export const FOCUS_LAST_START = -1;

// ── Block Component Interface (what each block exposes to the editor) ───────

export interface BlockComponent {
	focus(offset: number): void;
	getCursorOffset(): number | null;
	getSelectedText?(): string;
	setSelection?(start: number, end: number): void;
	/**
	 * Position the cursor at the offset nearest to editor-relative pixel X
	 * on the block's first visual line (`from === 'above'`) or last visual
	 * line (`from === 'below'`). Optional — blocks that don't participate in
	 * sticky column (code block, thematic break) omit this method, and
	 * callers fall back to focus(0) / focus(CURSOR_END).
	 */
	focusAtColumn?(x: number, from: StickyColumnDirection): void;
	/**
	 * Cascade focus down a path of child indices to reach a leaf at the
	 * given cursor offset. Implemented by container blocks (ListBlock,
	 * ListItemBlock) whose leaves may be arbitrarily deep; optional on
	 * leaf blocks that cannot nest further. Used by M1 to place the
	 * cursor at the merge point in a potentially deeply-nested target.
	 */
	focusByPath?(path: number[], offset: number): void;
	/**
	 * Report viewport-space client rects covering the character range
	 * [startOffset, endOffset) inside this block's visible text.
	 * Implemented by text/code leaves that can appear as an endpoint of a
	 * cross-block selection; SelectionOverlay converts the rects into
	 * wrapper-local coordinates when painting the partial highlight.
	 */
	measurePartialRects?(startOffset: number, endOffset: number): DOMRect[];
	readonly editable: boolean;
	readonly focusable: boolean;
}

// ── Undo Manager ────────────────────────────────────────────────────────────

export interface UndoEntry {
	snapshot: Document;
	blockIds: string[];
	/**
	 * The effective selection at the moment of push. Collapsed selection
	 * (anchor === focus) represents a single caret; same-path with different
	 * offsets is a single-block range; different paths is a cross-block
	 * range. See docs/superpowers/specs/2026-04-15-v0.4-selection-clipboard-design.md
	 * Undo / Redo Integration section.
	 */
	selection: EditorSelection;
}

export interface UndoManager {
	push(entry: UndoEntry): void;
	undo(currentState: UndoEntry): UndoEntry | null;
	redo(currentState: UndoEntry): UndoEntry | null;
	clear(): void;
	readonly canUndo: boolean;
	readonly canRedo: boolean;
}
