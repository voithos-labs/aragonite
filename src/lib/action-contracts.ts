/**
 * Every action interface a block component calls upward through Svelte context, plus
 * the commit types those calls are written in.
 */

import type { CstNode, TableAlignment } from './core/nodes';
import type { NodeView } from './core/node-views';
import type { StructuralChange } from './tree-operations/structural-change';
import type { TrackedPosition } from './tree-operations/settle';
import type { SharingState } from './tree-operations/sharing';
import type { BlockComponent, FocusPosition } from './block-component';
import type { ScopedOpDescriptor } from './schema/operations';
import type { DocPath } from './selection/path-math';

/**
 * Where the caret goes back to, stored with a commit's undo snapshot: `path` is a
 * document-absolute `DocPath` and must resolve in the tree before the mutation; `'skip'`
 * joins the entry the caller already pushed. Built by the block-list factories
 * (`block-edit-scope.ts`) or the `path-math` helpers, never assembled at a call site.
 */
export type CommitSnapshotArg = { path: DocPath; offset: number } | 'skip';

/**
 * Who owns the undo entry: `'own'` (the default) pushes one, `'join'` means the caller
 * already pushed the entry covering this composite operation and this must not add one.
 */
export type UndoEntryMode = 'own' | 'join';

/**
 * Opt-in for structural commits that may legitimately do nothing. The commit then throws
 * away the snapshot it took first: no undo entry, no edit event, nothing written to state
 * (`afterTick` still runs, since placing the caret is a view concern). Not for content or
 * metadata commits, whose `noop` `StructuralChange` means "structure held, bytes changed".
 */
export type DiscardIfNoop = boolean;

/**
 * The callback that runs after the tick, where a commit puts its caret. Awaited, so a caret
 * that must first scroll an unmounted target into view (VR-12) can be written here; that
 * scroll is bounded (VR-5), so awaiting cannot hang. Returning nothing opts out of the wait.
 */
export type CommitAfterTick = () => void | Promise<void>;

// ── Action sub-interfaces ──────────────────────────────────────────────────

export interface BlockEditActions {
	splitBlock(blockIndex: number, offset: number): void | Promise<void>;
	/**
	 * Focus the block after `blockIndex` in this list, creating an empty paragraph when it is
	 * the last child. If the next block is not mounted the caret stays put, key consumed.
	 */
	descendToBody(blockIndex: number): void | Promise<void>;
	/**
	 * @internal Create a paragraph holding `text` at a boundary of this list, caret after
	 * the text. `boundaryIndex === children.length` appends. How the between-blocks caret
	 * inserts (`selection/gap-caret.ts`).
	 */
	insertParagraph(boundaryIndex: number, text: string): void | Promise<void>;
	mergeWithPrevious(blockIndex: number): void | Promise<void>;
	mergeWithNext(blockIndex: number): void | Promise<void>;
	deleteBlock(blockIndex: number): void | Promise<void>;
	/**
	 * `preEditOffset` is the caret position the undo snapshot records; `postEditFocusOffset` is where
	 * the caret lands when a kind change remounts the block (typing `# ` on a paragraph),
	 * defaulting to `preEditOffset`.
	 */
	updateBlockContent(
		blockIndex: number,
		text: string,
		preEditOffset?: number,
		postEditFocusOffset?: number
	): void | Promise<void>;
	/**
	 * Where a caret at `offset` ends up once this list has committed `text`: the result of a
	 * container's `bodyWrite` rewrite, so a block whose committed bytes differ from its DOM
	 * puts the caret on the bytes. Returns `offset` unchanged when nothing is rewritten.
	 */
	mapCommittedOffset?(text: string, offset: number): number;
	/**
	 * Change block metadata without touching raw: for state held as metadata (task
	 * checkboxes), not for metadata derived from raw like a heading's level (use
	 * `updateBlockContent`). The patch is shallow-merged; an empty patch does nothing.
	 */
	updateBlockMetadata(
		blockIndex: number,
		metadata: Record<string, unknown>,
		options?: { undoEntry?: UndoEntryMode; afterTick?: CommitAfterTick }
	): void | Promise<void>;
	/**
	 * Replace the block at `blockIndex` with zero or more new blocks.
	 * `replacement.length === 0` is the same as `deleteBlock`. `focus.path` addresses a caret
	 * position inside the replacement's own structure; `snapshotOffset` is where the caret was,
	 * for the undo entry, and defaults to where it ends up.
	 */
	replaceBlock(
		blockIndex: number,
		replacement: CstNode[],
		focus?: { replacementIndex: number; offset: number; path?: number[] },
		options?: { undoEntry?: UndoEntryMode; snapshotOffset?: number }
	): void | Promise<void>;
}

export interface MoveFocusOptions {
	/**
	 * When false, a move past the true document end no-ops instead of appending a trailing
	 * paragraph; only the root append is suppressed, sibling moves and upward delegation
	 * are unaffected. Defaults to true (Enter/split rely on the append).
	 */
	append?: boolean;
	/** @internal Set by a move that leaves a between-blocks caret, so the boundary it just
	 *  left cannot capture it again. */
	skipGapStop?: boolean;
}

export interface FocusActions {
	moveFocus(
		blockIndex: number,
		position: FocusPosition,
		options?: MoveFocusOptions
	): void | Promise<void>;
	/** Mount a top-level block that is not rendered yet before placing a caret in it; see
	 *  `EditorActionsDeps.revealPath`. */
	revealPath(path: number[]): Promise<BlockComponent | null>;
	/**
	 * @internal Put the caret at a between-blocks boundary that allows one, reporting whether
	 * it did. Required, not optional: a container that fails to forward the call makes every
	 * such caret below it silently vanish.
	 */
	tryGapStop(parentPath: number[], boundaryIndex: number): boolean;
}

export interface HistoryActions {
	requestUndo(): void | Promise<void>;
	requestRedo(): void | Promise<void>;
}

/**
 * The copy a container or multi-list commit hands its `mutate`: `node` is the unshared copy
 * already spliced into the live tree. Never write through references captured before the
 * commit; they may be the originals an undo snapshot still shares.
 */
export interface ContainerScope {
	node: CstNode;
	children: CstNode[];
	sharing: SharingState;
}

// ── Multi-scope commit ──────────────────────────────────────────────────────
// Single-sourced here so the commit/undo and paste layers share one definition.

export interface MultiScopeTarget {
	/** Which block list this is; a view is enough, since the commit copies the ancestor chain
	 *  and makes its own mutable copy. */
	node: NodeView;
	/** The `BlockListState` fields the commit writes: ids by assignment, refs only in place,
	 *  because the array identity is the list's and replacing it strands its teardowns. */
	state: {
		innerBlockIds: string[];
		readonly innerBlockRefs: (BlockComponent | undefined)[];
	};
	/** Document-absolute path of `node`; the commit copies its ancestor chain before writing. */
	path: number[];
}

export interface CommitMultiScopeArgs<
	S extends readonly MultiScopeTarget[] = readonly MultiScopeTarget[]
> {
	/** `scopes[0]` is the outermost: an inner block's raw must be current before an outer
	 *  one rebuilds. */
	scopes: S;
	snapshot: CommitSnapshotArg;
	/** One view in, one `StructuralChange` out per list, same order; checked as a tuple. */
	mutate: (scopeViews: { [K in keyof S]: ContainerScope }) => {
		readonly [K in keyof S]: StructuralChange;
	};
	op?: ScopedOpDescriptor;
	afterTick?: CommitAfterTick;
	discardIfNoop?: DiscardIfNoop;
	/**
	 * Caret positions each list's fix-up keeps up to date, parallel to `scopes`: a container
	 * that collapses moves the bytes under a position chosen before the fix-up ran. Written
	 * in place, so `afterTick` reads the updated position off the object it passed in.
	 */
	trackCaret?: readonly (TrackedPosition | undefined)[];
}

export interface CommitStructuralArgs {
	snapshot: CommitSnapshotArg;
	mutate: (children: CstNode[]) => StructuralChange;
	op?: ScopedOpDescriptor;
	afterTick?: CommitAfterTick;
	/** Leaf(ves) for the dev invariant check when `mutate` returns `noop` (in-place kind change). */
	touchedNodes?: CstNode[];
	discardIfNoop?: DiscardIfNoop;
}

export interface CommitContainerStructuralArgs {
	/** Which container this is; a view is enough, since the commit copies the ancestor chain
	 *  and makes its own mutable copy. */
	containerNode: NodeView;
	/** Document-absolute path of `containerNode`: the ancestor chain the commit copies and
	 *  rebuilds. */
	path: number[];
	state: {
		innerBlockIds: string[];
		readonly innerBlockRefs: (BlockComponent | undefined)[];
	};
	snapshot: CommitSnapshotArg;
	mutate: (scope: ContainerScope) => StructuralChange;
	op?: ScopedOpDescriptor;
	afterTick?: CommitAfterTick;
	discardIfNoop?: DiscardIfNoop;
}

/**
 * The commit calls with no selection types in them, so `selection/` can depend on this
 * without pulling in `EditorSelection` or `UndoEntry`. `UndoController`
 * (editor-actions/deps) adds the two selection-typed members.
 */
export interface CommitController {
	/** The editor's structural-sharing counters, for copy-before-write outside a commit. */
	sharing: SharingState;
	pushUndoSnapshot(blockIndex: number, offset: number): void;
	/** A snapshot whose fallback, when there is no caret, is a deep leaf path (a search match
	 *  nested in a list item). */
	pushUndoSnapshotPath(path: number[], offset: number): void;
	/** Debounced typing snapshot; `leafPath` is the edited leaf's document-absolute path. */
	pushUndoSnapshotDebounced(leafPath: number[], offset: number, batchKey?: string | number): void;
	/** Start the batch's pause timer, once the keystroke's own edit is done. Paired with
	 *  every `pushUndoSnapshotDebounced`, or the batch never ends on a pause. */
	armUndoPause(): void;
	commitStructural(args: CommitStructuralArgs): Promise<void>;
	commitContainerStructural(args: CommitContainerStructuralArgs): Promise<void>;
	commitMultiScope<const S extends readonly MultiScopeTarget[]>(
		args: CommitMultiScopeArgs<S>
	): Promise<void>;
	/**
	 * Expose the document root as a `MultiScopeTarget`, so a `commitMultiScope` caller can
	 * include changes at the document level alongside containers (a cross-block delete whose
	 * common ancestor is the root).
	 */
	getDocScope(): MultiScopeTarget;
	/** Flush the pending keystroke batch (emit its `input` event and clear the debounce
	 *  timer) before an undo or redo, so the batch's bytes aren't lost. */
	flushDebouncedCheckpoint(): void;
	/** Run a command's byte write as its own undo entry. A command is not typing, so the
	 *  keystroke batch breaks on both sides: one Ctrl+Z takes back the command alone. */
	isolateUndoEntry(write: () => void): void;
}

export interface ContainerEditActions {
	/**
	 * Push a debounced undo snapshot for routine text input. `leafPath` is the edited
	 * leaf's document-absolute path; `batchKey` (its stable block id) breaks the batch on
	 * focus moves between sibling leaves.
	 */
	pushDebouncedCheckpoint(leafPath: number[], offset: number, batchKey?: string | number): void;
	/** The checkpoint's other half: start the pause timer once the keystroke's edit is done. */
	armDebouncedPause(): void;
	/**
	 * Tell the view about a raw change made outside the commit call, forwarded unchanged
	 * through nested containers. It rebuilds no raw itself: a writer outside a commit
	 * rebuilds through `withUnsharedSpine`, which works on its own copies.
	 */
	nudgeReactivity(): void;
	/**
	 * Copy-before-write wrapper for writes outside a commit (routine typing): copies the
	 * ancestor chain from the document root to `absPath`, calls `write` with that chain
	 * (outermost first) and the counter for copying anything off it, then rebuilds
	 * innermost-first. The caller still pushes its own checkpoint and notifies the view. True
	 * means the rebuild changed a container's kind (typing out `> [!TIP]`), remounting the
	 * edited leaf, so the caller replaces the caret; `write` returns its own change to report.
	 */
	withUnsharedSpine(
		absPath: number[],
		write: (chain: CstNode[], sharing: SharingState) => StructuralChange | void
	): boolean;
	/**
	 * The preferred way to change a container's structure: copy the ancestor chain, snapshot,
	 * write to state, emit the edit event, run the post-tick callback. `mutate` receives the
	 * copied container with its working children attached; write through it, never a capture.
	 */
	commitContainer(args: CommitContainerStructuralArgs): Promise<void>;
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
	/** Promote a nested list item to the parent list's level. Called on the parent list's
	 *  context. `nestedListNode` says which list, as a live-tree reference; writes go through
	 *  the commit. */
	promoteNestedItem(
		parentItemIndex: number,
		nestedListNode: NodeView,
		nestedItemIndex: number
	): Promise<void>;
	/** Returns this list's index in its enclosing list (for nested-list promotion). */
	getContainingItemIndex(): number;
}

// ── Table context ──────────────────────────────────────────────────────────

export type CellPosition = 'start' | 'end' | number;

export interface TableContext {
	focusCell(rowIdx: number, colIdx: number, position: CellPosition): void;

	getStickyColumn(): number | null;
	setStickyColumn(colIdx: number): void;
	resetStickyColumn(): void;

	exitUpward(stickyX: number): void;
	exitDownward(stickyX: number): void;

	notifyCellFocused(rowIdx: number, colIdx: number): void;
	notifyCellBlurred(): void;

	insertRowAbove(rowIdx: number): Promise<void>;
	insertRowBelow(rowIdx: number): Promise<void>;
	insertColumnLeft(colIdx: number): Promise<void>;
	insertColumnRight(colIdx: number): Promise<void>;
	deleteRow(rowIdx: number): Promise<void>;
	deleteColumn(colIdx: number): Promise<void>;
	/** Move a body row up/down among body rows. The header row is fixed (no-op on it). */
	moveRowUp(rowIdx: number): Promise<void>;
	moveRowDown(rowIdx: number): Promise<void>;
	/** Move a body row to an arbitrary target index (drag reorder); no-op if from === to. */
	reorderRowTo(from: number, to: number): Promise<void>;
	/** Move a column to an arbitrary target index (drag reorder); no-op if from === to. */
	reorderColumnTo(from: number, to: number): Promise<void>;
	/** Move a column left/right; no-op at the first/last column boundary. */
	moveColumnLeft(colIdx: number): Promise<void>;
	moveColumnRight(colIdx: number): Promise<void>;
	cycleAlignment(colIdx: number): Promise<void>;
	/** Set a column's alignment directly, as opposed to cycling it. */
	setColumnAlignment(colIdx: number, alignment: TableAlignment): Promise<void>;
	/** Write a grid of cell texts from `origin`, appending the rows and columns it needs, as one
	 *  commit: a spreadsheet-like paste. Empty grids are a no-op. */
	pasteGrid(origin: { rowIdx: number; colIdx: number }, grid: string[][]): Promise<void>;
}

/**
 * The `TableContext` mutations addressed by a single row or column index, the names both the
 * hover menu and the cell's table commands dispatch through. Derived from the interface
 * rather than listed beside it, so a member with any other signature cannot be named.
 */
export type TableAxisAction = {
	[K in keyof TableContext]: TableContext[K] extends (index: number) => Promise<void> ? K : never;
}[keyof TableContext];
