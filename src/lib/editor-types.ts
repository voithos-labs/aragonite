/**
 * Interfaces for the block editor system.
 * See docs/editor/editor.md for the design spec.
 */

import type { CstNode, Document } from './core/nodes';

// Re-export CstNode and Document so consumers can import from here
export type { CstNode, Document } from './core/nodes';

// ── Context Keys ────────────────────────────────────────────────────────────

export const EDITOR_ACTIONS_KEY = Symbol('editor-actions');

// ── Editor Actions (block → editor communication via Svelte context) ────────

export interface EditorActions {
	splitBlock(blockIndex: number, offset: number): void | Promise<void>;
	mergeWithPrevious(blockIndex: number): void | Promise<void>;
	deleteBlock(blockIndex: number): void | Promise<void>;
	moveFocus(blockIndex: number, position: 'start' | 'end' | number): void | Promise<void>;
	updateBlockContent(blockIndex: number, text: string, preEditOffset?: number): void;
	requestUndo(): void | Promise<void>;
	requestRedo(): void | Promise<void>;
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
