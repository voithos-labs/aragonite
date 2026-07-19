/**
 * View-layer contract for a rendered block: focus/cursor/measurement
 * surface plus the cursor sentinels and ambient-prefix shape that
 * block components produce and consume.
 */

import type { DocumentView, NodeView } from './core/node-views';

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

// ── BlockComponentProps ──────────────────────────────────────────────────────

/**
 * The props BlockHost passes every block component: the node, its sibling index,
 * the absolute path, and the ambient prefix a leaf renders before its content (a
 * list marker, a blockquote bar). A registry `extraProps` may add kind-specific
 * props on top. A component may declare a subset — Svelte ignores props it omits,
 * but a leaf that drops `ambientPrefix` visually deletes its markers.
 */
export interface BlockComponentProps {
	/** Bytes-readonly view (G1.9): components render the CST; mutation routes through actions. */
	node: NodeView;
	index: number;
	myPath: number[];
	ambientPrefix: AmbientPrefix;
	/** The root document, readonly by type — mutation stays a commit-ceremony concern. */
	document?: DocumentView;
}

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
	 * Async sibling of getBlockComponentByPath: at each nested level, scroll the
	 * child into its window and await its mount before recursing, so an off-window
	 * target resolves instead of returning null. Adjacent (already-mounted) targets
	 * resolve via the fast path with no scroll.
	 */
	revealByPath?(path: number[]): Promise<BlockComponent | null>;
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
	 * Viewport-space rect of a single cell, addressed by 2D coordinate. For
	 * whole-cell highlighting (search matches) on grid surfaces, where the
	 * caller has a `[rowIdx, colIdx]` and wants that cell's box directly,
	 * bypassing measurePartialRects' selection-aware range logic. Returns null
	 * when the cell isn't mounted or the coordinate is out of range.
	 */
	cellRect?(rowIdx: number, colIdx: number): DOMRect | null;
	/**
	 * Current mounted row-window `[start, end)` of a row-windowed grid surface
	 * (table). Overlays read it reactively so a repaint fires after the window
	 * re-slices and the new rows are committed (off-window rows can't paint until
	 * mounted). Absent on non-windowed-grid blocks.
	 */
	mountedRowWindow?(): { start: number; end: number };
	/**
	 * True when vertical traversal (ArrowUp/Down sticky-column dispatch)
	 * should pass straight through this block — the block has no caret-able
	 * text positions of its own, only widgets that carry no column meaning.
	 * Container blocks return true only when every inner ref is transparent.
	 */
	isVerticallyTransparent?(): boolean;
	/**
	 * Enter an edge widget instead of placing a caret at its boundary. A
	 * reveal-capable widget (inline math, directive text) opens its source reveal;
	 * any other widget is selected (image overlay). Returns true when an edge
	 * widget was entered; false lets the caller fall through to focus(0) /
	 * focus(CURSOR_END).
	 */
	enterEdgeWidget?(side: 'start' | 'end'): boolean;
	/**
	 * Run a named block-local command (split, indent, format, …) resolved from
	 * a keybinding. `arg` carries the binding's static argument (e.g. heading
	 * level) as `unknown`: the handler must type-guard it before use and ignore
	 * an out-of-shape value. Returns true when the command acted; false lets the
	 * caller fall through to remaining inline keydown branches. Block components
	 * that declare a keymap implement this; others omit it.
	 */
	runCommand?(id: import('./schema/command-id').AnyCommandId, arg?: unknown): boolean;
	/**
	 * Current raw-offset selection in an editable leaf (table cell), collapsed
	 * caret returned as `{start: n, end: n}`. Captured before a right-click menu
	 * steals focus so a later clipboard action can restore the exact range.
	 */
	getSelectionOffsets?(): { start: number; end: number } | null;
	/**
	 * Run a clipboard action from the table cell's right-click menu against the
	 * offsets captured at menu-open (focus/selection may have moved since).
	 */
	applyMenuClipboard?(
		action: 'cut' | 'copy' | 'paste',
		sel: { start: number; end: number }
	): Promise<void>;
	readonly editable: boolean;
	readonly focusable: boolean;
}
