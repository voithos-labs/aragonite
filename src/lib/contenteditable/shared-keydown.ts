/**
 * Shared keydown logic for contenteditable blocks.
 *
 * Both TextEditableBlock and CodeBlock route every keystroke through the
 * same prelude — Ctrl+A counter reset, cross-block dispatch, sticky-column
 * capture/reset, undo/redo, and arrow boundary navigation. This module
 * owns that prelude so the two blocks cannot drift.
 *
 * The block-specific tail (Enter, Backspace, Tab, formatting shortcuts)
 * stays in each component because the behaviors genuinely differ.
 */

import type {
	BlockElLookup,
	DocumentGetter,
	FocusActions,
	HistoryActions
} from '../contracts';
import type { StickyColumnState } from './sticky-column';
import { PRESERVE_KEYS_NON_ARROW } from './sticky-column';
import type { SelectionState } from '../selection/selection-state.svelte';
import type { CrossBlockHandlers } from '../selection/cross-block-dispatch';
import {
	extendFocusToNextBlock,
	extendFocusToPreviousBlock,
	scrollFocusBlockIntoView
} from '../selection/keyboard-extend';
import { getCurrentCursorEditorRelativeX } from './sticky-measure';
import { isAtFirstVisualLine, isAtLastVisualLine } from './visual-lines';
import { getSelectionFocusOffset } from './cursor-utils';

// ── Public API ─────────────────────────────────────────────────────────────

export interface SharedKeydownContext {
	getEl(): HTMLElement | null;
	getCursorOffset(): number | null;
	getMyPath(): number[];
	getIndex(): number;
	crossBlock: CrossBlockHandlers;
	selection: SelectionState;
	stickyColumn: StickyColumnState;
	history: HistoryActions;
	focus: FocusActions;
	getDoc: DocumentGetter;
	getBlockElByPath: BlockElLookup;
}

/**
 * Handle keystrokes shared by every contenteditable block. Returns true if
 * the event was fully handled — the caller must return immediately and skip
 * its block-specific branches.
 */
export async function handleSharedKeydown(
	e: KeyboardEvent,
	ctx: SharedKeydownContext
): Promise<boolean> {
	// Reset Ctrl+A doubling counter on any non-Ctrl+A keystroke. Bare
	// modifier keys (Control, Shift, Alt, Meta) don't reset — pressing
	// Control before 'a' is part of the Ctrl+A chord, not a separate action.
	const isCtrlA = (e.ctrlKey || e.metaKey) && e.key === 'a' && !e.shiftKey;
	const isBareModifier =
		e.key === 'Control' ||
		e.key === 'Shift' ||
		e.key === 'Alt' ||
		e.key === 'Meta' ||
		e.key === 'AltGraph' ||
		e.key === 'CapsLock';
	if (!isCtrlA && !isBareModifier) {
		ctx.selection.resetSelectAllCount();
	}

	if (await ctx.crossBlock.handleKeyDown(e)) return true;

	const el = ctx.getEl();
	if (!el) return false;

	// ── Sticky column: capture on vertical arrows, reset on non-preserve keys ──
	// Horizontal arrows, Home, End, Escape, and typable characters fall into
	// the else branch and reset sticky. PRESERVE_KEYS_NON_ARROW lists every
	// key that intentionally leaves sticky state untouched.
	if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
		const x = getCurrentCursorEditorRelativeX(el);
		if (x !== null) ctx.stickyColumn.capture(x);
	} else if (!PRESERVE_KEYS_NON_ARROW.includes(e.key)) {
		ctx.stickyColumn.reset();
	}

	// Ctrl+Z / Ctrl+Y — caught here because Ctrl+Y doesn't fire beforeinput
	// historyRedo in Chromium/WebView2.
	if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
		e.preventDefault();
		ctx.history.requestUndo();
		return true;
	}
	if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
		e.preventDefault();
		ctx.history.requestRedo();
		return true;
	}

	// ── Arrow boundary navigation ─────────────────────────────────────────
	// Each branch crosses the block boundary when the cursor is already at
	// the relevant edge. Shift variants extend the cross-block selection;
	// unshifted variants move single-block focus.
	const index = ctx.getIndex();
	const myPath = ctx.getMyPath();

	// For Shift+Arrow boundary checks, use the selection's FOCUS offset
	// rather than the range start (anchor). When the user has extended a
	// selection forward — e.g., clicked at offset 5 then Shift+clicked at
	// the block's end — the anchor stays at 5 while the focus sits at
	// the boundary. Reading the anchor would leave the boundary check
	// mid-block and silently fail to enter cross-block mode.
	const shiftOffset = e.shiftKey ? getSelectionFocusOffset(el) : null;

	if (e.key === 'ArrowUp') {
		const offset = shiftOffset ?? ctx.getCursorOffset() ?? 0;
		if (isAtFirstVisualLine(el, offset)) {
			// Shift+ArrowUp: native first extends to start of block content.
			// Only cross the boundary when the focus is already at offset 0,
			// so native extension has nowhere left to go.
			if (e.shiftKey && offset === 0) {
				e.preventDefault();
				extendFocusToPreviousBlock(ctx.selection, ctx.getDoc(), el, myPath, 'start');
				scrollFocusBlockIntoView(ctx.selection, ctx.getBlockElByPath);
				return true;
			}
			if (!e.shiftKey) {
				e.preventDefault();
				ctx.focus.moveFocus(index - 1, { stickyColumnFrom: 'below' });
				return true;
			}
		}
	}

	if (e.key === 'ArrowDown') {
		const offset = shiftOffset ?? ctx.getCursorOffset() ?? 0;
		const textLen = (el.textContent ?? '').length;
		if (isAtLastVisualLine(el, offset, textLen)) {
			// Shift+ArrowDown: native first extends to end of block content.
			// Only cross the boundary when the focus is already at the end,
			// so native extension has nowhere left to go.
			if (e.shiftKey && offset === textLen) {
				e.preventDefault();
				extendFocusToNextBlock(ctx.selection, ctx.getDoc(), el, myPath);
				scrollFocusBlockIntoView(ctx.selection, ctx.getBlockElByPath);
				return true;
			}
			if (!e.shiftKey) {
				e.preventDefault();
				ctx.focus.moveFocus(index + 1, { stickyColumnFrom: 'above' });
				return true;
			}
		}
	}

	if (e.key === 'ArrowLeft') {
		const offset = ctx.getCursorOffset();
		if (offset === 0) {
			if (e.shiftKey) {
				e.preventDefault();
				extendFocusToPreviousBlock(ctx.selection, ctx.getDoc(), el, myPath);
				scrollFocusBlockIntoView(ctx.selection, ctx.getBlockElByPath);
				return true;
			}
			e.preventDefault();
			ctx.focus.moveFocus(index - 1, 'end');
			return true;
		}
	}

	if (e.key === 'ArrowRight') {
		const textLen = (el.textContent ?? '').length;
		const offset = ctx.getCursorOffset();
		if (offset === textLen) {
			if (e.shiftKey) {
				e.preventDefault();
				extendFocusToNextBlock(ctx.selection, ctx.getDoc(), el, myPath);
				scrollFocusBlockIntoView(ctx.selection, ctx.getBlockElByPath);
				return true;
			}
			e.preventDefault();
			ctx.focus.moveFocus(index + 1, 'start');
			return true;
		}
	}

	return false;
}
