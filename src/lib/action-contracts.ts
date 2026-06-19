/**
 * Action interfaces that block components invoke through Svelte context:
 * structural edits, focus movement, history requests, container commits,
 * and the list-item operations a parent list exposes to its children.
 */

import type { CstNode } from './core/nodes';
import type { StructuralChange } from './tree-operations/structural-change';
import type { SharingState } from './undo/epoch-tracker';
import type { BlockComponent, FocusPosition } from './block-component';
import type { ScopedOpDescriptor } from './schema/operations';

/**
 * Who owns the undo entry for an operation. `'own'` (the default): the
 * implementation pushes its own entry. `'join'`: the caller has already
 * pushed the one entry covering this composite operation — the
 * implementation must not push another.
 */
export type UndoEntryMode = 'own' | 'join';

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
		options?: { undoEntry?: UndoEntryMode }
	): void | Promise<void>;
	/**
	 * Insert parsed blocks at a split point. `preDelete` folds a pre-paste
	 * selection deletion into the same undo entry as the splice so Ctrl+Z
	 * undoes the whole paste in one step.
	 */
	insertParsedBlocks(
		blockIndex: number,
		offset: number,
		blocks: CstNode[],
		preDelete?: { start: number; end: number },
		options?: { undoEntry?: UndoEntryMode }
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
	node: CstNode;
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
	/** `scopes[0]` is the outermost — it drives the emitted event path. */
	scopes: S;
	snapshot: { blockIndex: number; offset: number } | 'skip';
	/** One view in, one StructuralChange out per scope, same order — tuple-checked for literal scope arrays. */
	mutate: (scopeViews: { [K in keyof S]: ContainerScope }) => {
		readonly [K in keyof S]: StructuralChange;
	};
	op?: ScopedOpDescriptor;
	afterTick?: () => void;
}

export interface ContainerEditActions {
	/**
	 * Push a debounced undo snapshot for routine text input. `batchKey`
	 * (when supplied) identifies the leaf block being typed in so focus
	 * moves between sibling leaves inside one container break the undo
	 * batch — without it, all siblings share the outer container's
	 * blockIndex and one undo entry spans typing across multiple inner
	 * blocks.
	 */
	pushDebouncedCheckpoint(blockIndex: number, offset: number, batchKey?: string | number): void;
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
	commitContainer(args: {
		containerNode: CstNode;
		path: number[];
		state: {
			innerBlockIds: string[];
			innerBlockRefs: (BlockComponent | undefined)[];
		};
		snapshot: { blockIndex: number; offset: number } | 'skip';
		mutate: (scope: ContainerScope) => StructuralChange;
		op?: ScopedOpDescriptor;
		afterTick?: () => void;
	}): Promise<void>;
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
	cycleAlignment(colIdx: number): Promise<void>;
}
