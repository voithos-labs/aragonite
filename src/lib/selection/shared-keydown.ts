/**
 * Shared keydown prelude for contenteditable blocks: Ctrl+A counter, cross-block dispatch,
 * sticky-column capture/reset, undo/redo, arrow boundary navigation. Block-specific handlers
 * (Enter, Backspace, Tab, formatting) stay in each component.
 */

import type { FocusActions, HistoryActions } from '../action-contracts';
import type { BlockElLookup, DocumentGetter } from '../editor-keys';
import type { StickyColumnState } from '../cursor/sticky-column';
import type { EdgeAffinityState } from '../cursor/edge-affinity';
import type { SelectionState } from './selection-state.svelte';
import type { CrossBlockHandlers } from './cross-block/dispatch';
import {
	extendFocusToNextBlock,
	extendFocusToPreviousBlock,
	scrollFocusBlockIntoView
} from './keyboard-extend';
import { getCurrentCursorEditorRelativeX } from '../cursor/sticky-measure';
import { revealsNoMarkers } from '../cursor/widget-offset';
import { isAtFirstVisualLine, isAtLastVisualLine } from '../cursor/visual-lines';
import { getContentRange } from '../core/inline';
import { blockNodeAt } from '../tree-operations/node-ops';
import { eventToChord } from '../schema/keybindings';
import { isEditorGlobalChord } from '../schema/commands';

// ── Public API ─────────────────────────────────────────────────────────────

export interface SharedKeydownContext {
	getEl(): HTMLElement | null;
	/** Current caret offset in raw-content coordinates (ambient marker excluded). */
	getCursorOffset(): number | null;
	/** Shift-selection focus offset in raw-content coordinates (ambient marker excluded). */
	getFocusOffset(): number | null;
	/** textContent length in raw-content coordinates (ambient marker excluded). */
	getTextLen(): number;
	getMyPath(): number[];
	getIndex(): number;
	crossBlock: CrossBlockHandlers;
	selection: SelectionState;
	stickyColumn: StickyColumnState;
	edgeAffinity: EdgeAffinityState;
	history: HistoryActions;
	focus: FocusActions;
	getDoc: DocumentGetter;
	getBlockElByPath: BlockElLookup;
}

/** True when the event was fully handled; the caller must skip its block-specific branches. */
export async function handleSharedKeydown(
	e: KeyboardEvent,
	ctx: SharedKeydownContext
): Promise<boolean> {
	// Bare modifier keys don't reset the Ctrl+A doubling counter: pressing Control before 'a' is
	// part of the chord, not a separate action.
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

	ctx.stickyColumn.noteKey(e, () => getCurrentCursorEditorRelativeX(el));
	ctx.edgeAffinity.note(e);

	// The editor owns every editor-global chord (undo/redo and plugin globals alike): native
	// contenteditable history stays suppressed on keydown, since Ctrl+Y doesn't fire beforeinput
	// historyRedo in Chromium/WebView2. Precise chord matching, not a loose key check, then
	// defers the command to the block's override-aware dispatch so a consumer can rebind it.
	const historyChord = eventToChord(e);
	if (historyChord && isEditorGlobalChord(historyChord)) {
		e.preventDefault();
		return false;
	}

	// ── Arrow boundary navigation ─────────────────────────────────────────
	const index = ctx.getIndex();
	const myPath = ctx.getMyPath();
	// Lazy: off the arrow path the block's bounds are never asked for, and the resolve
	// walks the doc path and re-derives the content range.
	let cachedBounds: ContentBounds | null = null;
	const bounds = () => (cachedBounds ??= contentBounds(ctx, el));

	// Read the focus offset (not the anchor) for Shift+Arrow: after a forward extension the
	// anchor stays mid-block while the focus sits at the boundary.
	const shiftOffset = e.shiftKey ? ctx.getFocusOffset() : null;

	if (e.key === 'ArrowUp') {
		const offset = shiftOffset ?? ctx.getCursorOffset() ?? 0;
		if (isAtFirstVisualLine(el, offset)) {
			// Cross the boundary only when focus is already at the block's first reachable
			// offset, so native Shift+ArrowUp extension has nowhere left to go within it.
			if (e.shiftKey && offset <= bounds().start) {
				e.preventDefault();
				extendFocusToPreviousBlock(ctx.selection, ctx.getDoc(), el, myPath, 'start');
				scrollFocusBlockIntoView(ctx.selection, ctx.getBlockElByPath);
				return true;
			}
			if (!e.shiftKey && !e.altKey) {
				e.preventDefault();
				void ctx.focus.moveFocus(index - 1, { stickyColumnFrom: 'below' });
				return true;
			}
		}
	}

	if (e.key === 'ArrowDown') {
		const offset = shiftOffset ?? ctx.getCursorOffset() ?? 0;
		if (isAtLastVisualLine(el, offset, bounds().end)) {
			// Cross the boundary only when focus is already at the block's last reachable
			// offset, so native Shift+ArrowDown extension has nowhere left to go.
			if (e.shiftKey && offset >= bounds().end) {
				e.preventDefault();
				extendFocusToNextBlock(ctx.selection, ctx.getDoc(), el, myPath, 'vertical');
				scrollFocusBlockIntoView(ctx.selection, ctx.getBlockElByPath);
				return true;
			}
			if (!e.shiftKey && !e.altKey) {
				e.preventDefault();
				void ctx.focus.moveFocus(index + 1, { stickyColumnFrom: 'above' });
				return true;
			}
		}
	}

	if (e.key === 'ArrowLeft') {
		// Shift+Arrow reads focus, not anchor: getCursorOffset() gives the range start, which is
		// the anchor for a forward selection. That would extend cross-block while focus is
		// contracting toward a non-zero anchor, and misfire for backward selections.
		const offset = e.shiftKey ? (ctx.getFocusOffset() ?? bounds().start) : ctx.getCursorOffset();
		if (offset !== null && offset <= bounds().start) {
			if (e.shiftKey) {
				e.preventDefault();
				extendFocusToPreviousBlock(ctx.selection, ctx.getDoc(), el, myPath);
				scrollFocusBlockIntoView(ctx.selection, ctx.getBlockElByPath);
				return true;
			}
			e.preventDefault();
			void ctx.focus.moveFocus(index - 1, 'end');
			return true;
		}
	}

	if (e.key === 'ArrowRight') {
		const offset = e.shiftKey ? (ctx.getFocusOffset() ?? bounds().end) : ctx.getCursorOffset();
		if (offset !== null && offset >= bounds().end) {
			if (e.shiftKey) {
				e.preventDefault();
				extendFocusToNextBlock(ctx.selection, ctx.getDoc(), el, myPath);
				scrollFocusBlockIntoView(ctx.selection, ctx.getBlockElByPath);
				return true;
			}
			e.preventDefault();
			void ctx.focus.moveFocus(index + 1, 'start');
			return true;
		}
	}

	return false;
}

// ── Block bounds ───────────────────────────────────────────────────────────

interface ContentBounds {
	start: number;
	end: number;
}

/**
 * The raw offsets a caret can actually reach in this block. A mode that hides a block's own
 * structural markers with no reveal leaves those bytes unreachable, so the exits move in to
 * the content range; every other mode paints them and keeps the whole raw span.
 */
function contentBounds(ctx: SharedKeydownContext, el: HTMLElement): ContentBounds {
	const textLen = ctx.getTextLen();
	if (!revealsNoMarkers(el)) return { start: 0, end: textLen };
	const node = blockNodeAt(ctx.getDoc(), ctx.getMyPath());
	if (!node) return { start: 0, end: textLen };
	const range = getContentRange(node);
	// Clamped against the live DOM length: a revealed source holds bytes the CST has not
	// seen, and a bound past the block's end would trap the caret.
	return { start: Math.min(range.start, textLen), end: Math.min(range.end, textLen) };
}

// ── Shared beforeinput prelude ─────────────────────────────────────────────

/**
 * Routes historyUndo/historyRedo through the undo controller and delegates cross-block
 * paste/type-replace. True when the caller should return early from its own `onBeforeInput`.
 */
export async function handleSharedBeforeInput(
	e: InputEvent,
	ctx: { history: HistoryActions; crossBlock: CrossBlockHandlers }
): Promise<boolean> {
	if (e.inputType === 'historyUndo') {
		e.preventDefault();
		void ctx.history.requestUndo();
		return true;
	}
	if (e.inputType === 'historyRedo') {
		e.preventDefault();
		void ctx.history.requestRedo();
		return true;
	}
	if (await ctx.crossBlock.handleBeforeInput(e)) return true;
	return false;
}
