/**
 * Editor-wide contract surface: context keys, action interfaces,
 * cursor sentinels, block component shape.
 * See docs/design/editor/editor.md for the design spec.
 */

import type { CstNode, Document } from './core/nodes';
import type { EditorSelection } from './selection/primitives';
import type { StructuralChange } from './tree-operations/structural-change';

// ── Re-exported core types ─────────────────────────────────────────────────

export type { CstNode, Document } from './core/nodes';
export type { SelectionPoint, EditorSelection, SelectionDragStart } from './selection/primitives';

// ── Context key symbols ────────────────────────────────────────────────────

export const LIST_CONTEXT_KEY = Symbol('list-context');

export const STICKY_COLUMN_KEY = Symbol('sticky-column');

export const BLOCK_EDIT_KEY = Symbol('block-edit-actions');
export const FOCUS_KEY = Symbol('focus-actions');
export const HISTORY_KEY = Symbol('history-actions');
export const CONTAINER_EDIT_KEY = Symbol('container-edit-actions');

export const SELECTION_KEY = Symbol('selection');

export const EDITOR_ROOT_KEY = Symbol('editor-root');

/**
 * AbortSignal tied to the editor's mount lifetime. Document-level listeners
 * (drag-pointer, etc.) observe this to tear themselves down if the editor
 * unmounts mid-operation.
 */
export const EDITOR_LIFETIME_KEY = Symbol('editor-lifetime');

export const CONTROLLER_KEY = Symbol('undo-controller');

export const BLOCK_EL_LOOKUP_KEY = Symbol('block-el-lookup');

/** Getter-wrapped so block components always read the latest reactive Document. */
export const DOC_KEY = Symbol('editor-doc');

// ── Sentinels ──────────────────────────────────────────────────────────────

/**
 * "Place cursor at end of content." focus() clamps to content length, so the
 * exact value just needs to exceed any plausible block size. Kept distinct
 * from SELECTION_END below: this travels as a numeric offset that callers
 * compare and arithmetic on, while SELECTION_END travels as an opt-in
 * sentinel surfaces interpret in their own coordinate system. Sentinel-vs-
 * arithmetic distinction is the reason the values diverge.
 */
export const CURSOR_END = 999999;

/**
 * "Focus the last descendant at its start." Used after indent — cascade
 * through containers choosing the last child at each level, then place the
 * cursor at offset 0 on the leaf.
 */
export const FOCUS_LAST_START = -1;

/**
 * "End of this block's measurable range" for measurePartialRects' endOffset.
 * Interpretation per surface:
 * - Text contenteditable: end of textContent. Passed to createRangeFromOffsets,
 *   which clamps naturally.
 * - Cell-based (tables, future grid surfaces): cellCount — all cells from
 *   startOffset through the last cell.
 * - Opaque single-unit (image block, thematic break, embeds): any non-empty
 *   range returns the surface's bounding rect; SELECTION_END is treated the
 *   same as any endOffset > 0.
 *
 * Value is Number.MAX_SAFE_INTEGER so text surfaces rely on the existing
 * range-clamping behavior with zero migration.
 */
export const SELECTION_END = Number.MAX_SAFE_INTEGER;

// ── Helper types ───────────────────────────────────────────────────────────

export type BlockElLookup = (path: number[]) => HTMLElement | null;

export type DocumentGetter = () => Document;

/**
 * Direction the cursor is entering a block from for sticky-column moves.
 * `'above'` = downward move; `'below'` = upward move.
 */
export type StickyColumnDirection = 'above' | 'below';

/**
 * Focus position for moveFocus. The sticky-column variant aligns the cursor
 * to the current sticky X on the target's first or last visual line, falling
 * back to focus(0) / focus(CURSOR_END) when focusAtColumn is unimplemented.
 */
export type FocusPosition = 'start' | 'end' | number | { stickyColumnFrom: StickyColumnDirection };

// ── BlockComponent ─────────────────────────────────────────────────────────

export interface BlockComponent {
	focus(offset: number): void;
	getCursorOffset(): number | null;
	getSelectedText?(): string;
	setSelection?(start: number, end: number): void;
	/**
	 * Position the cursor at the offset nearest to editor-relative pixel X
	 * on the first (`'above'`) or last (`'below'`) visual line. Non-
	 * participating blocks omit this; callers fall back to focus(0) / CURSOR_END.
	 */
	focusAtColumn?(x: number, from: StickyColumnDirection): void;
	/**
	 * Cascade focus down a path of child indices to reach a leaf at the
	 * given offset. Container blocks implement it; leaves that cannot nest
	 * further omit it.
	 */
	focusByPath?(path: number[], offset: number): void;
	/**
	 * Viewport-space rects covering [startOffset, endOffset) in this block's
	 * visible text, for cross-block selection painting. Accepts SELECTION_END
	 * as endOffset to mean "from startOffset through the last measurable
	 * position in this block"; surfaces interpret per their coordinate
	 * system (see the SELECTION_END docstring).
	 */
	measurePartialRects?(startOffset: number, endOffset: number): DOMRect[];
	readonly editable: boolean;
	readonly focusable: boolean;
}

// ── Action sub-interfaces ──────────────────────────────────────────────────

export interface BlockEditActions {
	splitBlock(blockIndex: number, offset: number): void | Promise<void>;
	mergeWithPrevious(blockIndex: number): void | Promise<void>;
	mergeWithNext(blockIndex: number): void | Promise<void>;
	deleteBlock(blockIndex: number): void | Promise<void>;
	/**
	 * `preEditOffset` is the cursor anchor for the undo snapshot — restored on Ctrl+Z.
	 * `postEditFocusOffset` is where the caret lands when a kind change remounts the
	 * block (e.g. typing `# ` converts paragraph → heading). Defaults to preEditOffset
	 * for callers that don't trigger kind transitions.
	 */
	updateBlockContent(
		blockIndex: number,
		text: string,
		preEditOffset?: number,
		postEditFocusOffset?: number
	): void | Promise<void>;
	/**
	 * Mutate block metadata without touching raw. For adornments that express
	 * state as metadata rather than raw syntax (task checkboxes, etc.) — NOT
	 * for raw-driven metadata like heading level (change via updateBlockContent).
	 *
	 * Patch is shallow-merged. Empty patch is a no-op.
	 */
	updateBlockMetadata(
		blockIndex: number,
		metadata: Record<string, unknown>,
		options?: { skipSnapshot?: boolean }
	): void | Promise<void>;
	/**
	 * Insert parsed blocks at a split point. `preDelete` folds a pre-paste
	 * selection deletion into the same undo entry as the splice so Ctrl+Z
	 * undoes the whole paste in one step.
	 *
	 * `skipSnapshot`: cross-block paste path coalesces the range-delete and
	 * splice snapshots. Caller must have pushed exactly one snapshot already.
	 */
	insertParsedBlocks(
		blockIndex: number,
		offset: number,
		blocks: CstNode[],
		preDelete?: { start: number; end: number },
		options?: { skipSnapshot?: boolean }
	): void | Promise<void>;
	/**
	 * Replace the block at `blockIndex` with zero or more new blocks.
	 * `replacement.length === 0` is equivalent to deleteBlock.
	 *
	 * `skipSnapshot`: when set, implementation must not push its own undo
	 * entry — the caller has already pushed one for the coalesced operation.
	 */
	replaceBlock(
		blockIndex: number,
		replacement: CstNode[],
		focus?: { replacementIndex: number; offset: number },
		options?: { skipSnapshot?: boolean }
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
	/**
	 * Bracketing snapshot — pushes one undo entry, no debounce. Survives outside
	 * the commit primitive because cross-block dispatch's typing path mutates
	 * raw directly and then nudges reactivity through the bracket. v0.7 cleanup
	 * candidate: rename to reflect actual scope (snapshot bookend, not "edit").
	 */
	beginContainerEdit(blockIndex: number, offset: number): void;
	/**
	 * Debounced undo snapshot for text input. `batchKey` (when supplied)
	 * identifies the leaf block being typed in so focus moves between sibling
	 * leaves inside one container break the undo batch — without it, all
	 * siblings share the outer container's blockIndex and one undo entry
	 * spans typing across multiple inner blocks.
	 */
	beginContainerEditDebounced(blockIndex: number, offset: number, batchKey?: string | number): void;
	/**
	 * Reactivity nudge (`doc.children = [...doc.children]`) for paths that
	 * mutate the document outside the commit primitive — cross-block typing,
	 * IME composition entry, drag/clipboard mutate notify. v0.7 cleanup
	 * candidate: rename to describe the nudge, not an "end of edit."
	 */
	endContainerEdit(): void;
	/**
	 * Preferred entry for structural container mutations. Routes through the
	 * unified commit primitive: snapshot + publish + edit event + post-tick.
	 */
	commitContainer(
		containerNode: CstNode,
		state: {
			innerBlockIds: string[];
			innerBlockRefs: (BlockComponent | undefined)[];
		},
		snapshot: { blockIndex: number; offset: number } | 'skip',
		mutate: (children: CstNode[]) => StructuralChange,
		afterTick?: () => void,
		op?: {
			kind: string;
			detail?: Record<string, unknown>;
			eventPath: number[];
		}
	): Promise<void>;
}

// ── List context ───────────────────────────────────────────────────────────

export interface ListContext {
	insertItemAfter(itemIndex: number, newItem?: CstNode): Promise<void>;
	exitListAtItem(itemIndex: number): Promise<void>;
	indentItem(itemIndex: number): Promise<void>;
	unindentItem(itemIndex: number): Promise<void>;
	/**
	 * Split the item mid-content: first half stays, second half moves into a
	 * new sibling item. Emits exactly one undo snapshot and one edit event.
	 */
	splitItemAtOffset(itemIndex: number, innerIndex: number, offset: number): Promise<void>;
	/** Promote a nested list item to the parent list level. Called on the PARENT list's context. */
	promoteNestedItem(
		parentItemIndex: number,
		nestedListNode: CstNode,
		nestedItemIndex: number
	): Promise<void>;
	/** Returns this list's index in its enclosing list (for nested-list promotion). */
	getContainingItemIndex(): number;
}

// ── Undo ───────────────────────────────────────────────────────────────────

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
