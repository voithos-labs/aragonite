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
import type { PluginActivation } from '../schema/plugin-activation';
import {
	extendFocusToNextBlock,
	extendFocusToPreviousBlock,
	scrollFocusBlockIntoView
} from './keyboard-extend';
import { getCurrentCursorEditorRelativeX } from '../cursor/sticky-measure';
import { landableRawBounds } from '../cursor/widget-offset';
import { isAtFirstVisualLine, isAtLastVisualLine } from '../cursor/visual-lines';
import { eventToChord } from '../schema/keybindings';
import { isDefaultGlobalChord } from '../schema/commands';

// ── Public API ─────────────────────────────────────────────────────────────

export interface SharedKeydownContext extends LandableBoundsContext {
	getEl(): HTMLElement | null;
	/** Current caret offset in raw-content coordinates (ambient marker excluded). */
	getCursorOffset(): number | null;
	/** Shift-selection focus offset in raw-content coordinates (ambient marker excluded). */
	getFocusOffset(): number | null;
	getIndex(): number;
	getMyPath(): number[];
	getDoc: DocumentGetter;
	crossBlock: CrossBlockHandlers;
	selection: SelectionState;
	stickyColumn: StickyColumnState;
	edgeAffinity: EdgeAffinityState;
	history: HistoryActions;
	focus: FocusActions;
	getBlockElByPath: BlockElLookup;
	/** The plugins this instance activated; without it the suppression below swallows a
	 *  chord another editor's plugin claimed. `undefined` = every installed plugin. */
	activePlugins: PluginActivation | undefined;
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

	// Native contenteditable history stays suppressed on keydown, since Ctrl+Y doesn't fire
	// beforeinput historyRedo in Chromium/WebView2. The DEFAULT table is the right question here:
	// it names the chords with a native history default, and running the command is the block's
	// own override-aware dispatch, one branch further on.
	const historyChord = eventToChord(e);
	if (historyChord && isDefaultGlobalChord(historyChord, ctx.activePlugins)) {
		e.preventDefault();
		return false;
	}

	// ── Arrow boundary navigation ─────────────────────────────────────────
	const index = ctx.getIndex();
	const myPath = ctx.getMyPath();
	// Lazy: off the arrow path the block's bounds are never asked for, and the resolve
	// walks the block's DOM.
	let cachedBounds: LandableBounds | null = null;
	const bounds = () => (cachedBounds ??= caretLandableBounds(ctx, el));

	// Read the focus offset (not the anchor) for Shift+Arrow: after a forward extension the
	// anchor stays mid-block while the focus sits at the boundary.
	const shiftOffset = e.shiftKey ? ctx.getFocusOffset() : null;

	if (e.key === 'ArrowUp') {
		const offset = shiftOffset ?? ctx.getCursorOffset() ?? 0;
		if (isAtFirstVisualLine(el, offset, bounds().start)) {
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

export interface LandableBounds {
	start: number;
	end: number;
}

/** The reads the bounds need, so a block-edge gate outside this file can ask without standing up
 *  the whole keydown context. */
export interface LandableBoundsContext {
	/** textContent length in raw-content coordinates (ambient marker excluded). */
	getTextLen(): number;
	getAmbientLength(): number;
}

/**
 * The raw offsets a caret can actually reach in this block, from the walk that decides where a
 * caret lands. A mode that hides a block's own markers with no reveal puts those bytes out of
 * reach, so the exits move in to what the DOM can land — the kind's declared content range is
 * not that bound: paragraph, fenced code and table cell each declare the whole raw and still
 * open or close with a run nothing paints. Every block-edge gate reads this, not 0/length.
 */
export function caretLandableBounds(ctx: LandableBoundsContext, el: HTMLElement): LandableBounds {
	return landableRawBounds(el, ctx.getAmbientLength()) ?? { start: 0, end: ctx.getTextLen() };
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
