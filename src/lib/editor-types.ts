/**
 * Interfaces for the block editor system.
 * See docs/editor/editor.md for the design spec.
 */

// ── Context Keys ────────────────────────────────────────────────────────────

export const EDITOR_ACTIONS_KEY = Symbol('editor-actions');

// ── Editor Actions (block → editor communication via Svelte context) ────────

export interface EditorActions {
	splitBlock(blockIndex: number, offset: number): void | Promise<void>;
	mergeWithPrevious(blockIndex: number): void | Promise<void>;
	deleteBlock(blockIndex: number): void | Promise<void>;
	moveFocus(blockIndex: number, position: 'start' | 'end' | number): void | Promise<void>;
	updateBlockContent(blockIndex: number, text: string): void;
	requestUndo(): void | Promise<void>;
	requestRedo(): void | Promise<void>;
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
	snapshot: MutableDocument;
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

// ── Mutable Tree Types ──────────────────────────────────────────────────────

export interface MutableNode {
	kind: string;
	leadingTrivia: string;
	raw: string;
	metadata?: Record<string, unknown>;
	innerPrefix?: string;
	children?: MutableNode[];
	innerSuffix?: string;
}

export interface MutableDocument {
	kind: 'document';
	prefix: string;
	children: MutableNode[];
	suffix: string;
}
