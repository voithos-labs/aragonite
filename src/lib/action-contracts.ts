/**
 * Every action interface a block component invokes upward through Svelte context, plus
 * the commit vocabulary those calls are expressed in.
 */

import type { CstNode, TableAlignment } from './core/nodes';
import type { NodeView } from './core/node-views';
import type { StructuralChange } from './tree-operations/structural-change';
import type { SharingState } from './tree-operations/sharing';
import type { BlockComponent, FocusPosition } from './block-component';
import type { ScopedOpDescriptor } from './schema/operations';
import type { DocPath } from './selection/path-math';

/**
 * Caret-restore coordinate stored with a commit's undo snapshot: `path` is the `DocPath`
 * dialect and must resolve in the pre-mutation tree; `'skip'` joins the caller's
 * already-pushed entry. Minted by the scope factories (`block-edit-scope.ts`) or the
 * `path-math` helpers, never composed at a call site.
 */
export type CommitSnapshotArg = { path: DocPath; offset: number } | 'skip';

/**
 * Who owns the undo entry: `'own'` (the default) pushes one, `'join'` means the caller
 * already pushed the entry covering this composite operation and this must not add one.
 */
export type UndoEntryMode = 'own' | 'join';

/**
 * Opt-in for structural commits that can legitimately no-op. The ceremony then discards
 * the pre-captured snapshot: no undo entry, no edit event, no publish (`afterTick` still
 * runs — caret placement is a view concern). NOT for content/metadata commits, whose
 * `noop` StructuralChange means "structure held, bytes changed" and MUST still publish.
 */
export type DiscardIfNoop = boolean;

/**
 * Post-tick view callback — where a commit lands its caret. Awaited, so a landing that
 * must first reveal an off-window target (VR-12) is expressible here; the reveal is
 * bounded (VR-5), so awaiting cannot hang. Returning nothing opts out of the wait.
 */
export type CommitAfterTick = () => void | Promise<void>;

// ── Action sub-interfaces ──────────────────────────────────────────────────

export interface BlockEditActions {
	splitBlock(blockIndex: number, offset: number): void | Promise<void>;
	/**
	 * Focus the block after `blockIndex` in this scope, minting an empty paragraph when
	 * it is the last child. An off-window next block leaves the caret put, key consumed.
	 */
	descendToBody(blockIndex: number): void | Promise<void>;
	/**
	 * @internal Mint a paragraph carrying `text` at a BOUNDARY of this scope, caret after
	 * the text. `boundaryIndex === children.length` appends. The between-blocks caret's
	 * insertion door (`selection/gap-caret.ts`).
	 */
	insertParagraph(boundaryIndex: number, text: string): void | Promise<void>;
	mergeWithPrevious(blockIndex: number): void | Promise<void>;
	mergeWithNext(blockIndex: number): void | Promise<void>;
	deleteBlock(blockIndex: number): void | Promise<void>;
	/**
	 * `preEditOffset` is the undo snapshot's cursor anchor; `postEditFocusOffset` is where
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
	 * Where a caret at `offset` lands once this scope has committed `text` — the image of
	 * a container's `bodyWrite` rewrite, so a surface whose committed bytes differ from
	 * its DOM seats the caret on the bytes. Identity when the scope rewrites nothing.
	 */
	mapCommittedOffset?(text: string, offset: number): number;
	/**
	 * Mutate block metadata without touching raw — for state expressed as metadata (task
	 * checkboxes), NOT raw-driven metadata like heading level (use updateBlockContent).
	 * The patch is shallow-merged; an empty patch is a no-op.
	 */
	updateBlockMetadata(
		blockIndex: number,
		metadata: Record<string, unknown>,
		options?: { undoEntry?: UndoEntryMode; afterTick?: CommitAfterTick }
	): void | Promise<void>;
	/**
	 * Replace the block at `blockIndex` with zero or more new blocks.
	 * `replacement.length === 0` is equivalent to deleteBlock.
	 */
	replaceBlock(
		blockIndex: number,
		replacement: CstNode[],
		focus?: { replacementIndex: number; offset: number },
		options?: { undoEntry?: UndoEntryMode }
	): void | Promise<void>;
}

export interface MoveFocusOptions {
	/**
	 * When false, a move past the true document end no-ops instead of appending a trailing
	 * paragraph; only the root append is suppressed, sibling moves and upward delegation
	 * are unaffected. Defaults to true (Enter/split rely on the append).
	 */
	append?: boolean;
	/** @internal Set by a move that LEAVES a gap caret, so the boundary it just left
	 *  cannot re-capture it. */
	skipGapStop?: boolean;
}

export interface FocusActions {
	moveFocus(
		blockIndex: number,
		position: FocusPosition,
		options?: MoveFocusOptions
	): void | Promise<void>;
	/** Mount an off-window top-level block before placing a caret in it; see EditorActionsDeps.revealPath. */
	revealPath(path: number[]): Promise<BlockComponent | null>;
	/**
	 * @internal Park the caret at an eligible between-blocks boundary, reporting whether it
	 * did. Required, not optional: a dropped forward makes every gap arrival below it
	 * silently vanish.
	 */
	tryGapStop(parentPath: number[], boundaryIndex: number): boolean;
}

export interface HistoryActions {
	requestUndo(): void | Promise<void>;
	requestRedo(): void | Promise<void>;
}

/**
 * Owned mutation view handed to a container/multi-scope commit's `mutate`: `node` is the
 * unshared copy already spliced into the live tree. Never write through references
 * captured before the commit — they may be stale snapshot-shared originals.
 */
export interface ContainerScope {
	node: CstNode;
	children: CstNode[];
	sharing: SharingState;
}

// ── Multi-scope commit ──────────────────────────────────────────────────────
// Single-sourced here so the commit/undo and paste layers share one definition.

export interface MultiScopeTarget {
	/** Scope identity — a view suffices; the ceremony unshares the spine and mints the owned mutation view. */
	node: NodeView;
	state: {
		innerBlockIds: string[];
		innerBlockRefs: (BlockComponent | undefined)[];
	};
	/** Doc-absolute path of `node`; the commit primitive unshares its spine. */
	path: number[];
}

export interface CommitMultiScopeArgs<
	S extends readonly MultiScopeTarget[] = readonly MultiScopeTarget[]
> {
	/** `scopes[0]` is the outermost — inner raws must be current before outer rebuilds. */
	scopes: S;
	snapshot: CommitSnapshotArg;
	/** One view in, one StructuralChange out per scope, same order — tuple-checked for literal scope arrays. */
	mutate: (scopeViews: { [K in keyof S]: ContainerScope }) => {
		readonly [K in keyof S]: StructuralChange;
	};
	op?: ScopedOpDescriptor;
	afterTick?: CommitAfterTick;
	discardIfNoop?: DiscardIfNoop;
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
	/** Scope identity — a view suffices; the ceremony unshares the spine and mints the owned mutation view. */
	containerNode: NodeView;
	/** Doc-absolute path of `containerNode` — the spine the primitive unshares + rebuilds. */
	path: number[];
	state: {
		innerBlockIds: string[];
		innerBlockRefs: (BlockComponent | undefined)[];
	};
	snapshot: CommitSnapshotArg;
	mutate: (scope: ContainerScope) => StructuralChange;
	op?: ScopedOpDescriptor;
	afterTick?: CommitAfterTick;
	discardIfNoop?: DiscardIfNoop;
}

/**
 * Selection-free commit surface, so the selection layer can depend on it without
 * dragging in `EditorSelection`/`UndoEntry`. `UndoController` (editor-actions/deps)
 * extends it with the two selection-typed members.
 */
export interface CommitController {
	/** Editor's sharing epoch state, exposed for out-of-ceremony copy-path-on-write. */
	sharing: SharingState;
	pushUndoSnapshot(blockIndex: number, offset: number): void;
	/** Snapshot whose no-caret fallback seeds a deep leaf path (e.g. a match nested in a list item). */
	pushUndoSnapshotPath(path: number[], offset: number): void;
	/** Debounced typing snapshot; `leafPath` is the edited leaf's doc-absolute path. */
	pushUndoSnapshotDebounced(leafPath: number[], offset: number, batchKey?: string | number): void;
	commitStructural(args: CommitStructuralArgs): Promise<void>;
	commitContainerStructural(args: CommitContainerStructuralArgs): Promise<void>;
	commitMultiScope<const S extends readonly MultiScopeTarget[]>(
		args: CommitMultiScopeArgs<S>
	): Promise<void>;
	/**
	 * Expose the document root as a MultiScopeTarget so commitMultiScope
	 * callers can include doc-level splices alongside container scopes
	 * (e.g., a cross-block delete whose LCA is the document root).
	 */
	getDocScope(): MultiScopeTarget;
	/** Flush the pending keystroke batch — emit its `input` event and clear the
	 *  debounce timer — before a history swap, so the batch's bytes aren't lost. */
	flushDebouncedCheckpoint(): void;
	/** Run a command's byte write as its own undo entry. A command is not typing, so the
	 *  keystroke batch breaks on BOTH sides: one Ctrl+Z takes the command and nothing else. */
	isolateUndoEntry(write: () => void): void;
}

export interface ContainerEditActions {
	/**
	 * Push a debounced undo snapshot for routine text input. `leafPath` is the edited
	 * leaf's doc-absolute path; `batchKey` (its stable block id) breaks the batch on
	 * focus moves between sibling leaves.
	 */
	pushDebouncedCheckpoint(leafPath: number[], offset: number, batchKey?: string | number): void;
	/**
	 * Publish a raw change made outside the commit primitive, forwarded unchanged through
	 * nested containers. Raw rebuilds are NOT part of the nudge — out-of-ceremony writers
	 * rebuild via `withUnsharedSpine`, which operates on owned copies.
	 */
	nudgeReactivity(): void;
	/**
	 * Copy-path-on-write wrapper for out-of-ceremony writes (routine typing): unshares the
	 * spine doc-root → `absPath`, calls `write` with the owned chain (outermost first) and the
	 * epoch to own anything OFF that spine, then rebuilds innermost-first. The caller still pushes
	 * its own checkpoint and nudges. True means the rebuild re-derived a container's kind (typing
	 * out a `> [!TIP]` marker), remounting the edited leaf — the caller re-places the caret.
	 */
	withUnsharedSpine(
		absPath: number[],
		write: (chain: CstNode[], sharing: SharingState) => void
	): boolean;
	/**
	 * Preferred entry for structural container mutations: spine unshare, snapshot,
	 * publish, edit event, post-tick. `mutate` receives the OWNED container with its
	 * working children attached — mutate through it, never through captures.
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
	/** Promote a nested list item to the parent list level. Called on the PARENT list's context.
	 *  `nestedListNode` is scope identity (a live-tree reference) — a view; writes go through the ceremony. */
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
	/** Set a column's alignment directly — distinct from the cycle step. */
	setColumnAlignment(colIdx: number, alignment: TableAlignment): Promise<void>;
}

/**
 * The TableContext mutations addressed by ONE axis index, the vocabulary the affordance
 * menu and the cell's table commands both dispatch through. Derived from the contract
 * rather than listed beside it, so a member with any other signature cannot be named.
 */
export type TableAxisAction = {
	[K in keyof TableContext]: TableContext[K] extends (index: number) => Promise<void> ? K : never;
}[keyof TableContext];
