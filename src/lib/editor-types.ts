/**
 * Interfaces for the block editor system.
 * See docs/editor/design/editor.md for the design spec.
 */

import type { CstNode, Document } from './core/nodes';

// Re-export CstNode and Document so consumers can import from here
export type { CstNode, Document } from './core/nodes';

/** Sentinel offset meaning "place cursor at end of content". focus() clamps to content length. */
export const CURSOR_END = 999999;

// ── Context Keys ────────────────────────────────────────────────────────────

export const EDITOR_ACTIONS_KEY = Symbol('editor-actions');
export const LIST_CONTEXT_KEY = Symbol('list-context');
export const LIST_PARENT_ITEM_INDEX_KEY = Symbol('list-parent-item-index');

// ── List Context (list item → list block communication via Svelte context) ──

export interface ListContext {
	insertItemAfter(itemIndex: number, newItem?: CstNode): void;
	exitListAtItem(itemIndex: number): void;
	indentItem(itemIndex: number): void;
	unindentItem(itemIndex: number): void;
	/**
	 * Promote a nested list item to the parent list level.
	 * Called by a nested ListBlock on the PARENT list's context.
	 * @param parentItemIndex Index of the parent list item containing the nested list
	 * @param nestedListNode The nested list CstNode (for direct manipulation)
	 * @param nestedItemIndex Index of the item within the nested list to promote
	 */
	promoteNestedItem(parentItemIndex: number, nestedListNode: CstNode, nestedItemIndex: number): void;
}

// ── Editor Actions (block → editor communication via Svelte context) ────────

export interface EditorActions {
	splitBlock(blockIndex: number, offset: number): void | Promise<void>;
	mergeWithPrevious(blockIndex: number): void | Promise<void>;
	mergeWithNext(blockIndex: number): void | Promise<void>;
	deleteBlock(blockIndex: number): void | Promise<void>;
	moveFocus(blockIndex: number, position: 'start' | 'end' | number): void | Promise<void>;
	updateBlockContent(blockIndex: number, text: string, preEditOffset?: number): void;
	requestUndo(): void | Promise<void>;
	requestRedo(): void | Promise<void>;
	/** Insert parsed blocks at a split point, replacing the current block with spliced content. */
	insertParsedBlocks(blockIndex: number, offset: number, blocks: CstNode[]): void | Promise<void>;
	/** Push a document-level undo snapshot. Called by container blocks before structural mutations. */
	beginContainerEdit?(blockIndex: number, offset: number): void;
	/** Push a debounced undo snapshot. Called by container blocks for text input. */
	beginContainerEditDebounced?(blockIndex: number, offset: number): void;
	/** Trigger top-level Svelte reactivity after a container mutation. */
	endContainerEdit?(): void;
}

// ── Block Component Interface (what each block exposes to the editor) ───────

export interface BlockComponent {
	focus?(offset: number): void;
	getCursorOffset?(): number | null;
	getSelectedText?(): string;
	setSelection?(start: number, end: number): void;
	readonly editable: boolean;
	readonly focusable: boolean;
}

// ── Undo Manager ────────────────────────────────────────────────────────────

export interface UndoEntry {
	snapshot: Document;
	blockIds: string[];
	focusBlockIndex: number;
	focusOffset: number;
}

export interface UndoManager {
	push(entry: UndoEntry): void;
	undo(currentState: UndoEntry): UndoEntry | null;
	redo(currentState: UndoEntry): UndoEntry | null;
	clear(): void;
	readonly canUndo: boolean;
	readonly canRedo: boolean;
}
