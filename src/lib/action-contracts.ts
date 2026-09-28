/**
 * Every action interface a block component calls upward through Svelte context, plus
 * the commit types those calls are written in.
 */

import type { CstNode, TableAlignment } from './core/nodes';
import type { NodeView } from './core/node-views';
import type { LineEnding } from './core/lines';
import type { StructuralChange } from './tree-operations/structural-change';
import type { TrackedPosition } from './tree-operations/settle';
import type { SharingState } from './tree-operations/sharing';
import type { BodyParent } from './tree-operations/node-primitives';
import type { BlockComponent, FocusPosition } from './block-component';
import type { OperationDetailMap, ScopedOpDescriptor } from './schema/operations';
import type { WriteMode } from './schema/block-kind-descriptor';
import type { DocPath } from './selection/path-math';
import type { CaretPosition, Landing } from './selection/primitives';
import type { LegalWrite } from './tree-operations/content-write';
import type { LandingOutcome, RevealPolicy } from './selection/caret-landing';
import type { RemovalGesture } from './selection/caret-target';

/**
 * Where the caret goes back to on undo when nothing is focused: `path` is a document-absolute
 * `DocPath` and must resolve in the tree before the mutation. Built by the block-list factories
 * (`block-edit-scope.ts`) or the `path-math` helpers, never assembled at a call site.
 */
export type CommitSnapshotArg = { path: DocPath; offset: number };

/**
 * Opt-in for structural commits that may legitimately do nothing. The commit then throws
 * away the snapshot it took first: no undo entry, no edit event, nothing written to state
 * (its landing still runs, since a refused merge still crosses the boundary the key pressed at).
 * Not for content or metadata commits, whose `noop` `StructuralChange` means "structure held,
 * bytes changed".
 */
export type DiscardIfNoop = boolean;

/**
 * Where the caret goes after a commit, read after the tick so it sees the tree the commit left.
 * It returns a value and places nothing; the commit puts the caret there through the editor's
 * caret landing (`selection/caret-landing.ts`), and null leaves the caret where it is.
 */
export type CommitLanding = () => Landing | null;

/**
 * A callback that places the caret itself after the tick, left only for the delete and the typing
 * over a range that spans blocks, not yet on {@link CommitLanding}. Awaited, before the landing.
 */
export type CommitAfterTick = () => void | Promise<void>;

/**
 * What a screen reader hears about a commit (a move, a table edit) in the editor's edit live
 * region, read after the caret lands and only when bytes landed. That region hears nothing else, so a
 * refused, failed or discarded commit says nothing there.
 */
export type CommitAnnouncement = () => string;

/**
 * A content write in flight, resolving to whether bytes landed. `admitted` is known the moment the
 * call returns: false means the write was turned away before it touched anything (reading mode, or
 * a list with no text of its own to write). Only an admitted write has a caret: the landing offset
 * in the bytes as stored, with `storedOffset` mapping any other offset the same way.
 */
export type ContentWrite = Promise<boolean> & (RefusedContentWrite | AdmittedContentWrite);

export interface RefusedContentWrite {
	readonly admitted: false;
}

export interface AdmittedContentWrite {
	readonly admitted: true;
	readonly caret: number;
	storedOffset(offset: number): number;
	/** False when the write places the caret itself (a new kind, a merge, a changed container),
	 *  so the block must not put its own caret back. */
	readonly keepsCaret: boolean;
}

/** Where the caret goes after an edit to one block, relative to it: `path` walks its children
 *  (`[]` is the block itself) and `offset` is a byte there or an edge value (`CURSOR_END`). */
export interface BlockCaret {
	path: number[];
	offset: number;
}

// ── Action sub-interfaces ──────────────────────────────────────────────────

/** Every edit a block asks of its list. Each resolves to whether bytes landed; a focus move
 *  that writes nothing resolves false. */
export interface BlockEditActions {
	splitBlock(blockIndex: number, offset: number): Promise<boolean>;
	/**
	 * Focus the block after `blockIndex` in this list, creating an empty paragraph when it is
	 * the last child. If the next block is not mounted the caret stays put, key consumed.
	 */
	descendToBody(blockIndex: number): Promise<boolean>;
	/** @internal Create a paragraph holding `text` at a boundary of this list, caret after the
	 *  text; `boundaryIndex === children.length` appends. */
	insertParagraph(boundaryIndex: number, text: string): Promise<boolean>;
	mergeWithPrevious(blockIndex: number): Promise<boolean>;
	mergeWithNext(blockIndex: number): Promise<boolean>;
	/** Remove the block; the caret lands once, on the side `gesture` points
	 *  (`selection/caret-target.ts :: survivorAfterRemoval`), and the caller places none. */
	deleteBlock(blockIndex: number, gesture: RemovalGesture): Promise<boolean>;
	/** Write `text` as the block's bytes through its kind's and this list's write rules. Undo
	 *  records `preEditOffset`; `postEditFocusOffset` (in `text`) comes back mapped as `caret`. */
	updateBlockContent(
		blockIndex: number,
		text: string,
		mode: WriteMode,
		preEditOffset?: number,
		postEditFocusOffset?: number
	): ContentWrite;
	/** Change metadata raw does not derive (task checkboxes), shallow-merged. Metadata derived from
	 *  raw, like a heading's level, goes through `updateBlockContent`. */
	updateBlockMetadata(
		blockIndex: number,
		metadata: Record<string, unknown>,
		options?: { caret?: BlockCaret }
	): Promise<boolean>;
	/** Replace the block with zero or more blocks (none is `deleteBlock`). `focus.path` addresses a
	 *  caret inside the replacement; `snapshotOffset` is the undo entry's caret. */
	replaceBlock(
		blockIndex: number,
		replacement: CstNode[],
		focus?: { replacementIndex: number; offset: number; path?: number[] },
		options?: { snapshotOffset?: number }
	): Promise<boolean>;
}

export interface MoveFocusOptions {
	/** False stops a move past the document end from appending a trailing paragraph; sibling moves
	 *  and upward delegation are unaffected. Defaults to true, which Enter's split relies on. */
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
	/** @internal Put the caret at a between-blocks boundary that allows one. Required: a container
	 *  that fails to forward it makes every such caret below it vanish. */
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
	/** The document's line ending, which every line the mutation writes takes. */
	lineEnding: LineEnding;
	/** `children` as the body the tree operations write; at the document root it has no owner. */
	readonly body: BodyParent;
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
	/** Overridden when an ancestor collapsed: the collapse recreated the blocks it names. */
	landing?: CommitLanding;
	/** How far the landing moves the viewport; `'into-view'` when absent. */
	reveal?: RevealPolicy;
	announce?: CommitAnnouncement;
	discardIfNoop?: DiscardIfNoop;
	/** Caret positions each list's fix-up updates in place, parallel to `scopes`, since a collapsing
	 *  container moves the bytes under them; the landing reads them back off the same objects. */
	trackCaret?: readonly (TrackedPosition | undefined)[];
}

export interface CommitStructuralArgs {
	snapshot: CommitSnapshotArg;
	mutate: (children: CstNode[]) => StructuralChange;
	op?: ScopedOpDescriptor;
	afterTick?: CommitAfterTick;
	landing?: CommitLanding;
	reveal?: RevealPolicy;
	announce?: CommitAnnouncement;
	/** Leaves for the dev invariant check when `mutate` returns `noop` (an in-place kind change). */
	touchedNodes?: CstNode[];
	discardIfNoop?: DiscardIfNoop;
	/** A caret position the document's fix-up updates in place; the landing reads it back. */
	trackCaret?: TrackedPosition;
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
	landing?: CommitLanding;
	reveal?: RevealPolicy;
	announce?: CommitAnnouncement;
	discardIfNoop?: DiscardIfNoop;
	/** A caret position the container's fix-up updates in place; the landing reads it back. */
	trackCaret?: TrackedPosition;
}

/**
 * The commit calls with no selection types in them, so `selection/` can depend on this
 * without pulling in `EditorSelection` or `UndoEntry`. `UndoController`
 * (editor-actions/deps) adds the two selection-typed members.
 */
export interface CommitController {
	/** The editor's structural-sharing counters, for copy-before-write outside a commit. */
	sharing: SharingState;
	/** Debounced typing snapshot; `leafPath` is the edited leaf's document-absolute path. */
	pushUndoSnapshotDebounced(leafPath: number[], offset: number, batchKey?: string | number): void;
	/** Start the batch's pause timer, once the keystroke's own edit is done. Paired with
	 *  every `pushUndoSnapshotDebounced`, or the batch never ends on a pause. */
	armUndoPause(): void;
	/** Each commit resolves to whether bytes landed: false when declined, rolled back or a no-op
	 *  it discarded. */
	commitStructural(args: CommitStructuralArgs): Promise<boolean>;
	commitContainerStructural(args: CommitContainerStructuralArgs): Promise<boolean>;
	commitMultiScope<const S extends readonly MultiScopeTarget[]>(
		args: CommitMultiScopeArgs<S>
	): Promise<boolean>;
	/** The document root as a `MultiScopeTarget`, so a multi-scope commit can include root-level
	 *  changes (a cross-block delete whose common ancestor is the root). */
	getDocScope(): MultiScopeTarget;
	/** Flush the pending keystroke batch (emit its `input` event and clear the debounce
	 *  timer) before an undo or redo, so the batch's bytes aren't lost. */
	flushDebouncedCheckpoint(): void;
	/** Run a command's byte write as its own undo entry. A command is not typing, so the
	 *  keystroke batch breaks on both sides: one Ctrl+Z takes back the command alone. */
	isolateUndoEntry(write: () => void): void;
	/** Make every write made while `run` is pending one undo entry, restoring the selection the step
	 *  opened with (`seed` when unfocused). Ends when `run` settles or at the author's next input. */
	undoStep(seed: CommitSnapshotArg, run: () => Promise<unknown>): Promise<void>;
	/** Called on the author's own input: every later write opens its own entry, even while a
	 *  step's run is still pending. */
	endUndoStep(): void;
}

/** What a container reaches the editor root for, forwarded unchanged through nested containers.
 *  A keystroke runs `typeInLeaf`, then a commit or `writeLeafInPlace` (`leaf-write.ts`). */
export interface ContainerEditActions {
	/** The document's line ending, which every line a write below the root creates takes. */
	lineEnding(): LineEnding;
	/** Change a container's structure as one undo entry. `mutate` receives the copied container
	 *  with its working children attached; write through it, never through a captured node. */
	commitContainer(args: CommitContainerStructuralArgs): Promise<boolean>;
	/** Push the typing burst's undo entry for the leaf at `leafPath`, then run `work` joined to
	 *  it; `batchKey` is the leaf's id, so a move to a sibling leaf starts a new burst. */
	typeInLeaf<T>(
		leafPath: DocPath,
		preEditOffset: number,
		batchKey: string,
		work: () => Promise<T>
	): Promise<T>;
	/** The keystroke's write outside a commit, for a write that keeps the leaf's kind. */
	writeLeafInPlace(leafPath: DocPath, write: LegalWrite, caret: number): InPlaceResult;
	/** Put the caret at a document position through the editor's caret landing, for an edit that
	 *  moves the caret without a commit. */
	land(pos: CaretPosition): Promise<LandingOutcome>;
	/** Where the caret goes once the block at `removedPath` is gone, read on the document now. */
	survivorAfterRemoval(removedPath: DocPath, gesture: RemovalGesture): CaretPosition | null;
}

export type InPlaceResult =
	| { readonly wrote: false }
	| {
			readonly wrote: true;
			/** Where the caret goes when the write took it out of the leaf's element (a merge, an
			 *  ancestor that changed kind or collapsed); null when the leaf's element keeps it. */
			readonly relanding: Relanding | null;
	  };

/** A caret to put back after a write, and the blocks the write left where it wrote: focus already
 *  outside them means a blur committed the write, and the caret stays where it went. */
export interface Relanding {
	readonly caret: CaretPosition;
	readonly window: { readonly list: DocPath; readonly at: number; readonly count: number };
}

/** What a commit writing new text into one leaf resolves to. */
export type LeafWriteResult = { readonly wrote: false } | LeafWriteLanded;

/** `caret` is where the caret goes after the write and its list's fix-up, and `window` the
 *  written block's replacement run; a collapsed ancestor places the caret itself afterwards. */
export interface LeafWriteLanded extends Relanding {
	readonly wrote: true;
	/** Whether the write put new blocks in the position rather than rewriting the leaf. */
	readonly replaced: boolean;
}

/** A leaf write by document path: `caret` is an offset into the text as written, `snapshotOffset`
 *  one into the leaf's current bytes, where undo puts the caret back when nothing is focused. */
export interface LeafTextOptions {
	caret: number;
	snapshotOffset: number;
	/** Runs after the tick, before a collapsed ancestor places the caret itself. */
	afterTick?: (landed: LeafWriteLanded) => void | Promise<void>;
}

// ── Replace ─────────────────────────────────────────────────────────────────

/** Which replacement block the caret lands in, at `offset` (`CURSOR_END` for its end) or at
 *  `path` below it. */
export interface ReplaceFocus {
	replacementIndex: number;
	offset: number;
	path?: number[];
}

export interface ReplaceOptions {
	/** Where undo puts the caret back, when it differs from where the replacement lands it. */
	snapshotOffset?: number;
	/** A clipboard's own trailing blank line, landed as the document's when nothing follows. */
	trailingBlank?: boolean;
	/** The route a paste or a drop names in the edit event, in place of the block count. */
	source?: ReplaceSource;
}

export type ReplaceSource = Extract<
	OperationDetailMap['replaceBlock'],
	{ source: unknown }
>['source'];

// ── List context ───────────────────────────────────────────────────────────

/** A list's item edits; each resolves to whether bytes landed. */
export interface ListContext {
	insertItemAfter(itemIndex: number, newItem?: CstNode): Promise<boolean>;
	exitListAtItem(itemIndex: number): Promise<boolean>;
	indentItem(itemIndex: number): Promise<boolean>;
	unindentItem(itemIndex: number): Promise<boolean>;
	/**
	 * Split the item mid-content: first half stays, second half moves into a
	 * new sibling item. Emits exactly one undo snapshot and one edit event.
	 */
	splitItemAtOffset(itemIndex: number, innerIndex: number, offset: number): Promise<boolean>;
	/** Promote a nested list item to this parent list's level; `nestedListNode` is a live-tree
	 *  reference, and writes go through the commit. */
	promoteNestedItem(
		parentItemIndex: number,
		nestedListNode: NodeView,
		nestedItemIndex: number
	): Promise<boolean>;
	/** Returns this list's index in its enclosing list (for nested-list promotion). */
	getContainingItemIndex(): number;
}

// ── Table context ──────────────────────────────────────────────────────────

export type CellPosition = 'start' | 'end' | number;

export interface TableContext {
	focusCell(rowIdx: number, colIdx: number, position: CellPosition): void;
	/** Scroll the grid sideways so the cell's column is inside the table's own box. */
	revealColumn(rowIdx: number, colIdx: number): void;

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
