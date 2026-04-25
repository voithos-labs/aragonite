/**
 * View-layer contract for a rendered block: focus/cursor/measurement
 * surface plus the cursor sentinels and ambient-prefix shape that
 * block components produce and consume.
 */

import type { Document } from './core/nodes';

// ── Sentinels ──────────────────────────────────────────────────────────────

/**
 * "Place cursor at end of content." focus() clamps to content length, so the
 * exact value just needs to exceed any plausible block size. Distinct from
 * SELECTION_END because callers do arithmetic on this offset, whereas
 * SELECTION_END is an opt-in sentinel each surface interprets in its own
 * coordinate system.
 */
export const CURSOR_END = 999999;

/**
 * "Focus the last descendant at its start." Used after indent — cascade
 * through containers choosing the last child at each level, then place the
 * cursor at offset 0 on the leaf.
 */
export const FOCUS_LAST_START = -1;

/**
 * "End of this block's measurable range" for measurePartialRects' endOffset.
 * Each surface interprets it in its own coordinate system; the value is
 * Number.MAX_SAFE_INTEGER so text surfaces fall through to native range
 * clamping without special-casing.
 */
export const SELECTION_END = Number.MAX_SAFE_INTEGER;

// ── Helper types ───────────────────────────────────────────────────────────

export type BlockElLookup = (path: number[]) => HTMLElement | null;

export type DocumentGetter = () => Document;

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

export type AmbientPrefix =
	| string
	| { text: string; interactive?: AmbientInteractiveRange[] };

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
	/**
	 * Cascade focus down a path of child indices to reach a leaf at the
	 * given offset. Container blocks implement it; leaves that cannot nest
	 * further omit it.
	 */
	focusByPath?(path: number[], offset: number): void;
	/**
	 * Viewport-space rects covering [startOffset, endOffset) in this block's
	 * visible text, for cross-block selection painting. Accepts SELECTION_END
	 * as endOffset to mean "from startOffset through the last measurable
	 * position in this block"; surfaces interpret per their coordinate
	 * system (see the SELECTION_END docstring).
	 */
	measurePartialRects?(startOffset: number, endOffset: number): DOMRect[];
	readonly editable: boolean;
	readonly focusable: boolean;
}
