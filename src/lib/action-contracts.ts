/**
 * Every action interface a block component invokes upward through Svelte
 * context, plus the commit vocabulary those calls are expressed in and the
 * per-container contracts a parent exposes to its own children. The section
 * dividers below are the index; this header deliberately doesn't restate them.
 */

import type { CstNode, TableAlignment } from './core/nodes';
import type { NodeView } from './core/node-views';
import type { StructuralChange } from './tree-operations/structural-change';
import type { SharingState } from './tree-operations/sharing';
import type { BlockComponent, FocusPosition } from './block-component';
import type { ScopedOpDescriptor } from './schema/operations';
import type { DocPath } from './selection/path-math';

/**
 * No-caret caret-restore coordinate stored with a commit's undo snapshot:
 * `path` is the `DocPath` dialect and must resolve in the pre-mutation tree.
 * `'skip'` joins the caller's already-pushed entry (composite operations). The
 * scope factories (`block-edit-scope.ts`) mint the path from local indices;
 * other op families compose it through the `path-math` mint helpers.
 */
export type CommitSnapshotArg = { path: DocPath; offset: number } | 'skip';

/**
 * Who owns the undo entry for an operation. `'own'` (the default): the
 * implementation pushes its own entry. `'join'`: the caller has already
 * pushed the one entry covering this composite operation — the
 * implementation must not push another.
 */
export type UndoEntryMode = 'own' | 'join';

/**
 * Opt-in for structural commits (split/merge/delete) that can legitimately no-op
 * — a chrome `block.split` (single-line, unsplittable) or a merge with no
 * reachable text leaf. When the mutation reports no structural change, the
 * ceremony discards the pre-captured snapshot: no undo entry, no edit event, no
 * publish (`afterTick` still runs — caret placement is a view concern). NOT for
 * content/metadata commits, whose `noop` StructuralChange means "structure held,
 * bytes changed" and MUST still publish.
 */
export type DiscardIfNoop = boolean;

// ── Action sub-interfaces ──────────────────────────────────────────────────

export interface BlockEditActions {
	splitBlock(blockIndex: number, offset: number): void | Promise<void>;
	/**
	 * Focus the block after `blockIndex` in this scope, minting an empty paragraph
	 * when `blockIndex` is the last child. Two callers: the reserved-chrome Enter
	 * gesture (descend from a chrome leaf into its body), and the closed-fence
	 * Enter-exit landing its new paragraph inside the fence's own container. A next
	 * block whose ref is off-window leaves the caret put (the key is still consumed).
	 */
	descendToBody(blockIndex: number): void | Promise<void>;
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
	 * Patch is shallow-merged. Empty patch is a no-op. `afterTick` runs once the
	 * commit's DOM has settled — the post-commit caret hook (a collapse toggle
	 * moves the orphaned body caret to its chrome row here).
	 */
	updateBlockMetadata(
		blockIndex: number,
		metadata: Record<string, unknown>,
		options?: { undoEntry?: UndoEntryMode; afterTick?: () => void }
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
	 * When false, a move past the true document end no-ops instead of appending a
	 * trailing paragraph. Only the root append is suppressed; sibling moves and
	 * upward delegation are unaffected. Defaults to true (Enter/split rely on the
	 * append). Forward-Delete at a block's trailing boundary passes false: it is a
	 * focus move when a next block exists, a no-op at the document end.
	 */
	append?: boolean;
}

export interface FocusActions {
	moveFocus(
		blockIndex: number,
		position: FocusPosition,
		options?: MoveFocusOptions
	): void | Promise<void>;
	/** Mount an off-window top-level block before placing a caret in it; see EditorActionsDeps.revealPath. */
	revealPath(path: number[]): Promise<BlockComponent | null>;
}

export interface HistoryActions {
	requestUndo(): void | Promise<void>;
	requestRedo(): void | Promise<void>;
}

/**
 * Owned mutation view handed to a container/multi-scope commit's `mutate`.
 * `node` is the unshared copy already spliced into the live tree with
 * `children` attached — never write through references captured before the
 * commit; they may be stale snapshot-shared originals.
 */
export interface ContainerScope {
	node: CstNode;
	children: CstNode[];
	sharing: SharingState;
}

// ── Multi-scope commit ──────────────────────────────────────────────────────
// Single-sourced here (the contracts leaf) so the commit/undo layer
// (editor-actions) and the paste layer (tree-operations/paste) share one
// definition instead of each redeclaring it.

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
	afterTick?: () => void;
	discardIfNoop?: DiscardIfNoop;
}

export interface CommitStructuralArgs {
	snapshot: CommitSnapshotArg;
	mutate: (children: CstNode[]) => StructuralChange;
	op?: ScopedOpDescriptor;
	afterTick?: () => void;
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
	afterTick?: () => void;
	discardIfNoop?: DiscardIfNoop;
}

/**
 * Selection-free commit surface: snapshot pushers and the structural commit
 * primitives. Lives in the contracts leaf so the selection layer can depend on
 * it without dragging in `EditorSelection`/`UndoEntry`. `UndoController`
 * (editor-actions/deps) extends this with the two selection-typed members.
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
}

export interface ContainerEditActions {
	/**
	 * Push a debounced undo snapshot for routine text input. `leafPath` is the
	 * edited leaf's doc-absolute path (it seeds the snapshot's no-caret restore
	 * point and the batched `input` event). `batchKey` (the leaf's stable block
	 * id, when supplied) breaks the batch on focus moves between sibling leaves.
	 */
	pushDebouncedCheckpoint(leafPath: number[], offset: number, batchKey?: string | number): void;
	/**
	 * Publish a raw change the caller made outside the commit primitive — a
	 * `doc.children = [...doc.children]` reactivity nudge at the editor root,
	 * forwarded unchanged through nested containers. Raw rebuilds are NOT part
	 * of the nudge: out-of-ceremony writers rebuild via `withUnsharedSpine`
	 * (or the sharing-aware rebuild helpers), which operate on owned copies.
	 */
	nudgeReactivity(): void;
	/**
	 * Copy-path-on-write wrapper for out-of-ceremony writes (routine typing):
	 * unshares the spine doc-root → `absPath`, invokes `write` with the owned
	 * chain (outermost first), then rebuilds the chain's container raws
	 * innermost-first. Caller still pushes its own checkpoint and nudges.
	 */
	withUnsharedSpine(absPath: number[], write: (chain: CstNode[]) => void): void;
	/**
	 * Preferred entry for structural container mutations. Routes through the
	 * unified commit primitive: spine unshare + snapshot + publish + edit
	 * event + post-tick. `mutate` receives the OWNED container with its
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
