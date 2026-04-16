/**
 * Interfaces for the block editor system.
 * See docs/design/editor/editor.md for the design spec.
 */

import type { CstNode, Document } from './core/nodes';
import type { EditorSelection } from './selection/selection-types';
import type { StickyColumnState } from './sticky-column';

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

// ── Context Keys ────────────────────────────────────────────────────────────

export const LIST_CONTEXT_KEY = Symbol('list-context');
/** Svelte context key for the editor's sticky-column state. @see StickyColumnState in `./sticky-column` for the value provided under this key. */
export const STICKY_COLUMN_KEY = Symbol('sticky-column');

// Decomposed action sub-interface context keys (cluster A).
export const BLOCK_EDIT_KEY = Symbol('block-edit-actions');
export const FOCUS_KEY = Symbol('focus-actions');
export const HISTORY_KEY = Symbol('history-actions');
export const CONTAINER_EDIT_KEY = Symbol('container-edit-actions');

/** Svelte context key for the editor's cross-block SelectionState. See `selection/selection-state.svelte.ts`. */
export const SELECTION_KEY = Symbol('selection');

/** Svelte context key for a lazy getter returning the editor's root DOM element. */
export const EDITOR_ROOT_KEY = Symbol('editor-root');

/**
 * Svelte context key for a `BlockElLookup` callback that resolves a block
 * path to its DOM element. Block components call this to find the focus or
 * anchor block during cross-block keyboard extension.
 */
export const BLOCK_EL_LOOKUP_KEY = Symbol('block-el-lookup');

/** Resolves a block path to its DOM element, or null if the path is unknown. */
export type BlockElLookup = (path: number[]) => HTMLElement | null;

/**
 * Svelte context key for a `DocumentGetter` that returns the current
 * reactive Document. Wrapped in a getter so block components always read
 * the latest value rather than capturing a stale snapshot at mount.
 */
export const DOC_KEY = Symbol('editor-doc');

/** Returns the editor's current Document. */
export type DocumentGetter = () => Document;

// ── List Context (list item → list block communication via Svelte context) ──

export interface ListContext {
	insertItemAfter(itemIndex: number, newItem?: CstNode): Promise<void>;
	exitListAtItem(itemIndex: number): Promise<void>;
	indentItem(itemIndex: number): Promise<void>;
	unindentItem(itemIndex: number): Promise<void>;
	/**
	 * Promote a nested list item to the parent list level.
	 * Called by a nested ListBlock on the PARENT list's context.
	 * @param parentItemIndex Index of the parent list item containing the nested list
	 * @param nestedListNode The nested list CstNode (for direct manipulation)
	 * @param nestedItemIndex Index of the item within the nested list to promote
	 */
	promoteNestedItem(
		parentItemIndex: number,
		nestedListNode: CstNode,
		nestedItemIndex: number
	): Promise<void>;
	/**
	 * For a nested list inside a list item, returns the item's index in its
	 * containing list. Used by nested lists to call promoteNestedItem with
	 * the correct parent-item coordinate. Provided by the immediately
	 * enclosing ListItemBlock wrapping its parent list's context.
	 */
	getContainingItemIndex(): number;
}

// ── Editor Actions (block → editor communication via Svelte context) ────────

/**
 * Origin direction for sticky-column cross-block focus moves.
 * - `'above'` — cursor is entering this block from the block above (a downward move).
 * - `'below'` — cursor is entering this block from the block below (an upward move).
 *
 * Used by both `FocusPosition.stickyColumnFrom` (moveFocus variant) and
 * `BlockComponent.focusAtColumn?`'s `from` parameter, so container blocks
 * can forward the value without translation.
 */
export type StickyColumnDirection = 'above' | 'below';

/**
 * Focus position for moveFocus. The sticky-column variant tells the target
 * block to position the cursor at the offset nearest to the current sticky X
 * on its first (stickyColumnFrom: 'above') or last (stickyColumnFrom: 'below')
 * visual line. Falls back to focus(0) / focus(CURSOR_END) if the target does
 * not implement focusAtColumn?.
 */
export type FocusPosition = 'start' | 'end' | number | { stickyColumnFrom: StickyColumnDirection };

// ── Action Sub-Interfaces (block → editor communication, split by concern) ──

export interface BlockEditActions {
	splitBlock(blockIndex: number, offset: number): void | Promise<void>;
	mergeWithPrevious(blockIndex: number): void | Promise<void>;
	mergeWithNext(blockIndex: number): void | Promise<void>;
	deleteBlock(blockIndex: number): void | Promise<void>;
	updateBlockContent(blockIndex: number, text: string, preEditOffset?: number): void;
	/** Insert parsed blocks at a split point, replacing the current block with spliced content. */
	insertParsedBlocks(blockIndex: number, offset: number, blocks: CstNode[]): void | Promise<void>;
	/**
	 * Replace the block at `blockIndex` with zero or more new blocks.
	 * Handles undo snapshot, ID generation, blockRefs splice, and post-tick
	 * focus. If `focus` is given, focuses the replacement block at that
	 * index (relative to the replacement array, not doc.children) with the
	 * given offset after tick.
	 *
	 * If `replacement.length === 0`, this is equivalent to deleteBlock(blockIndex).
	 */
	replaceBlock(
		blockIndex: number,
		replacement: CstNode[],
		focus?: { replacementIndex: number; offset: number }
	): void | Promise<void>;
}

export interface FocusActions {
	moveFocus(blockIndex: number, position: FocusPosition): void | Promise<void>;
}

export interface HistoryActions {
	requestUndo(): void | Promise<void>;
	requestRedo(): void | Promise<void>;
}

export interface ContainerEditActions {
	/** Push a document-level undo snapshot. Called by container blocks before structural mutations. */
	beginContainerEdit(blockIndex: number, offset: number): void;
	/** Push a debounced undo snapshot. Called by container blocks for text input. */
	beginContainerEditDebounced(blockIndex: number, offset: number): void;
	/** Trigger top-level Svelte reactivity after a container mutation. */
	endContainerEdit(): void;
}

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
