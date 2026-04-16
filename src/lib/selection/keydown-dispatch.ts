/**
 * Cross-block keyboard dispatch. The focus block's onKeyDown / onBeforeInput
 * handlers branch on `selection.isCrossBlock` and delegate here when active.
 *
 * Batch A ships the skeleton + a minimal set of helpers. Batch B fills in
 * the specific keystroke handlers (extend, collapse, select-all, etc.).
 * See docs/superpowers/specs/2026-04-15-v0.4-selection-clipboard-design.md
 * Keyboard Dispatch section for the dispatch table.
 */

import type { SelectionState } from './selection-state.svelte';
import { readNativeCaretInBlock, applyCollapsedCaret, clearNativeSelection } from './native-bridge';

// ── Public types ────────────────────────────────────────────────────────────

/**
 * Context object passed to every cross-block keyboard handler. Carries the
 * active selection state, the focus block's element + path, and callbacks
 * for path ↔ element resolution (provided by Editor.svelte).
 */
export interface CrossBlockKeyContext {
	selection: SelectionState;
	/** The focused block's element (for reading native selection if needed). */
	focusBlockEl: HTMLElement;
	/** The focused block's path in the document. */
	focusBlockPath: number[];
	/** Look up a block element by path — provided by Editor.svelte. */
	getBlockElByPath(path: number[]): HTMLElement | null;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Transition from single-block to cross-block mode on a keyboard extension
 * (Shift+Arrow leaving a block). Reads the native caret from
 * `currentBlockEl`, populates SelectionState with that caret as both anchor
 * and focus, then clears the native selection.
 *
 * The caller decides WHERE the focus should land — this function only
 * captures the anchor and enters cross-block mode with `focus === anchor`
 * initially. The caller immediately calls `selection.extendFocus(target)`
 * after this returns true.
 */
export function enterCrossBlockFromKeyboard(
	selection: SelectionState,
	currentBlockEl: HTMLElement,
	currentBlockPath: number[]
): boolean {
	const anchorPoint = readNativeCaretInBlock(currentBlockEl, currentBlockPath);
	if (!anchorPoint) return false;
	selection.enterCrossBlock(anchorPoint, { path: anchorPoint.path.slice(), offset: anchorPoint.offset });
	clearNativeSelection();
	return true;
}

/**
 * Collapse the cross-block selection to its start or end and restore a
 * native caret at that point. Exits cross-block mode.
 */
export function collapseCrossBlock(
	selection: SelectionState,
	to: 'start' | 'end',
	getBlockElByPath: (path: number[]) => HTMLElement | null
): void {
	const target = to === 'start' ? selection.start : selection.end;
	if (!target) return;
	selection.collapse();
	clearNativeSelection();
	const blockEl = getBlockElByPath(target.path);
	if (blockEl) {
		applyCollapsedCaret(blockEl, target);
		blockEl.focus();
	}
}

/**
 * After extending the focus endpoint, scroll the focus block into view.
 * No-op if the focus block is already visible.
 */
export function scrollFocusBlockIntoView(
	selection: SelectionState,
	getBlockElByPath: (path: number[]) => HTMLElement | null
): void {
	if (!selection.focus) return;
	const blockEl = getBlockElByPath(selection.focus.path);
	blockEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
