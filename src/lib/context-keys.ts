/**
 * Svelte context key symbols and the action/lookup interfaces provided
 * under each key. Extracted from editor-types so context wiring can be
 * imported without pulling in the full type surface.
 */

import type { CstNode, Document } from './core/nodes';

// ── Context Key Symbols ────────────────────────────────────────────────────

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

// ── List Context ───────────────────────────────────────────────────────────

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

// ── Action Sub-Interfaces ──────────────────────────────────────────────────

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

// ── FocusPosition (needed by FocusActions) ─────────────────────────────────

/**
 * Origin direction for sticky-column cross-block focus moves.
 * - `'above'` — cursor is entering this block from the block above (a downward move).
 * - `'below'` — cursor is entering this block from the block below (an upward move).
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
