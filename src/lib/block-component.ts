/**
 * View-layer contract for a rendered block: focus/cursor/measurement
 * surface plus the cursor sentinels and ambient-prefix shape that
 * block components produce and consume.
 */

// ── Sentinels ──────────────────────────────────────────────────────────────

declare const cursorEndBrand: unique symbol;
/** Branded `number`: a focus offset meaning "end of content", not a position. */
export type CursorEnd = number & { readonly [cursorEndBrand]: true };

declare const selectionEndBrand: unique symbol;
/** Branded `number`: a measurePartialRects endOffset meaning "end of range". */
export type SelectionEnd = number & { readonly [selectionEndBrand]: true };

/**
 * "Place cursor at end of content." The focus walkers fall through to their
 * end-of-content fallback whenever the requested offset exceeds the block's
 * length, so MAX_SAFE_INTEGER lands at the end of any block. A finite value
 * (the former 999999) instead landed mid-block once content was longer.
 */
export const CURSOR_END = Number.MAX_SAFE_INTEGER as CursorEnd;

/** Cascade focus to the last descendant and place the cursor at its start. */
export const FOCUS_LAST_START = -1;

/**
 * "End of this block's measurable range" for measurePartialRects' endOffset.
 * Each surface interprets it in its own coordinate system; MAX_SAFE_INTEGER
 * lets text surfaces fall through to native range clamping without special-
 * casing, and TableBlock matches it explicitly to select through the last cell.
 */
export const SELECTION_END = Number.MAX_SAFE_INTEGER as SelectionEnd;

// ── Helper types ───────────────────────────────────────────────────────────

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

// ── Ambient prefix ─────────────────────────────────────────────────────────

export interface AmbientInteractiveRange {
	start: number;
	end: number;
	className: string;
	role?: 'checkbox';
	ariaChecked?: boolean;
	onClick: () => void;
}

export type AmbientPrefix = string | { text: string; interactive?: AmbientInteractiveRange[] };

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
	/** Cascade focus down a path of child indices to reach a leaf at the given offset. */
	focusByPath?(path: number[], offset: number): void;
	/**
	 * Descend a path of child indices and return the BlockComponent at the
	 * leaf, or null if the path doesn't resolve. Empty `path` returns the
	 * current component. Container blocks implement it; leaf blocks rely on
	 * the default behavior (the path must be empty to match).
	 */
	getBlockComponentByPath?(path: number[]): BlockComponent | null;
	/**
	 * Deep cursor position for nested-block surfaces (e.g., table cells).
	 * Returns the path from this block to the leaf containing the cursor,
	 * plus the within-leaf offset. When implemented, Editor.svelte's
	 * getSelection() prefers this over getCursorOffset.
	 */
	getCursorPosition?(): { path: number[]; offset: number } | null;
	/**
	 * Viewport-space rects covering [startOffset, endOffset) in this block's
	 * visible text, for cross-block selection painting. Accepts SELECTION_END
	 * as endOffset to mean "from startOffset through the last measurable
	 * position in this block"; surfaces interpret per their coordinate
	 * system (see the SELECTION_END docstring).
	 */
	measurePartialRects?(startOffset: number, endOffset: number): DOMRect[];
	/**
	 * True when vertical traversal (ArrowUp/Down sticky-column dispatch)
	 * should pass straight through this block — the block has no caret-able
	 * text positions of its own, only widgets that carry no column meaning.
	 * Container blocks return true only when every inner ref is transparent.
	 */
	isVerticallyTransparent?(): boolean;
	/**
	 * Try to select an edge widget instead of placing a caret. Returns true
	 * when a widget at the requested boundary was selected; false lets the
	 * caller fall through to focus(0) / focus(CURSOR_END). Used by cross-block
	 * arrow dispatch so ArrowLeft into a paragraph that ends with an image
	 * lands on the image directly.
	 */
	selectEdgeWidget?(side: 'start' | 'end'): boolean;
	/**
	 * Run a named block-local command (split, indent, format, …) resolved from
	 * a keybinding. `arg` carries the binding's static argument (e.g. heading
	 * level). Returns true when the command acted; false lets the caller fall
	 * through to remaining inline keydown branches. Block components that
	 * declare a keymap implement this; others omit it.
	 */
	runCommand?(id: import('./schema/commands').CommandId, arg?: number): boolean;
	readonly editable: boolean;
	readonly focusable: boolean;
}
