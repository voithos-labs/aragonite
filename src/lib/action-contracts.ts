/**
 * Action interfaces that block components invoke through Svelte context:
 * structural edits, focus movement, history requests, container commits,
 * and the list-item operations a parent list exposes to its children.
 */

import type { CstNode } from './core/nodes';
import type { StructuralChange } from './tree-operations/structural-change';
import type { BlockComponent, FocusPosition } from './block-component';

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
	 * Push an undo snapshot now (no debounce) and invalidate any pending
	 * debounced batch. Used by paths that mutate raw outside the commit
	 * primitive — IME composition entry, cross-block typing, drag/clipboard
	 * sync mutates — where the snapshot must bracket the raw change.
	 */
	pushCheckpoint(blockIndex: number, offset: number): void;
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
	 * Publish a raw change the caller made outside the commit primitive.
	 * At the editor root this is a `doc.children = [...doc.children]`
	 * reactivity nudge; at a nested container it rebuilds this container's
	 * raw from its children and forwards upward so every ancestor raw
	 * stays in sync, then the root nudge runs once at the top.
	 */
	nudgeReactivity(): void;
	/**
	 * Preferred entry for structural container mutations. Routes through the
	 * unified commit primitive: snapshot + publish + edit event + post-tick.
	 */
	commitContainer(args: {
		containerNode: CstNode;
		state: {
			innerBlockIds: string[];
			innerBlockRefs: (BlockComponent | undefined)[];
		};
		snapshot: { blockIndex: number; offset: number } | 'skip';
		mutate: (children: CstNode[]) => StructuralChange;
		op?: {
			kind: string;
			detail?: Record<string, unknown>;
			eventPath: number[];
		};
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
