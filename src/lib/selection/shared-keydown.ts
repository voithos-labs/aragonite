/**
 * Shared keydown prelude for contenteditable blocks: Ctrl+A counter, cross-block dispatch,
 * the caret memory's key note, undo/redo, arrow boundary navigation. Block-specific handlers
 * (Enter, Backspace, Tab, formatting) stay in each component.
 */

import type { FocusActions, HistoryActions } from '../action-contracts';
import type { DocumentGetter } from '../editor-keys';
import type { CaretMemory } from '../cursor/caret-memory';
import type { ScrollOwner } from '../cursor/scroll-owner';
import type { SelectionState } from './selection-state.svelte';
import type { CrossBlockHandlers } from './cross-block/dispatch';
import type { CommandDispatchContext } from '../schema/block-commands';
import { commandAtBlock } from './cross-block/keydown';
import type { Reading } from '../schema/reading';
import {
	extendFocusToNextBlock,
	extendFocusToPreviousBlock,
	scrollFocusBlockIntoView
} from './keyboard-extend';
import { getCurrentCursorEditorRelativeX } from '../cursor/sticky-measure';
import { landableRawBounds } from '../cursor/widget-offset';
import { isAtFirstVisualLine, isAtLastVisualLine } from '../cursor/visual-lines';
import { endsSelectAllRun, eventToChord } from '../schema/keybindings';
import { isDefaultGlobalChord } from '../schema/commands';

// ── Public API ─────────────────────────────────────────────────────────────

export interface SharedKeydownContext extends LandableBoundsContext {
	getEl(): HTMLElement | null;
	/** Current caret offset in raw-content coordinates (the container's marker prefix excluded). */
	getCursorOffset(): number | null;
	/** Shift-selection focus offset in raw-content coordinates (the marker prefix excluded). */
	getFocusOffset(): number | null;
	getIndex(): number;
	getMyPath(): number[];
	getDoc: DocumentGetter;
	crossBlock: CrossBlockHandlers;
	selection: SelectionState;
	caretMemory: CaretMemory;
	history: HistoryActions;
	focus: FocusActions;
	/** Brings the block a Shift+Arrow extends into to the nearest edge. */
	scrollOwner: Pick<ScrollOwner, 'place'>;
	/** The editor's command dispatch: the caret memory reads a chord by its current binding, and
	 *  the history suppression below takes only this editor's plugin chords. */
	commands: CommandDispatchContext;
	/** How the editor reads its bytes, whose grammar the vertical extension skips leaves by. */
	reading: Reading;
}

/** True when the event was fully handled; the caller must skip its block-specific branches. */
export async function handleSharedKeydown(
	e: KeyboardEvent,
	ctx: SharedKeydownContext
): Promise<boolean> {
	if (endsSelectAllRun(e)) ctx.selection.resetSelectAllCount();

	if (await ctx.crossBlock.handleKeyDown(e)) return true;

	const el = ctx.getEl();
	if (!el) return false;

	ctx.caretMemory.noteKey(e, commandAtBlock(e, ctx), () => getCurrentCursorEditorRelativeX(el));

	// Ctrl+Y fires no `historyRedo` beforeinput in Chromium and WebView2, so every chord with a
	// native history default is suppressed here; the block's own dispatch runs the command.
	const historyChord = eventToChord(e);
	if (historyChord && isDefaultGlobalChord(historyChord, ctx.commands.activation)) {
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
		if (isAtFirstVisualLine(el, offset, bounds())) {
			// Cross the boundary only when focus is already at the block's first reachable
			// offset, so native Shift+ArrowUp extension has nowhere left to go within it.
			if (e.shiftKey && offset <= bounds().start) {
				e.preventDefault();
				extendFocusToPreviousBlock(
					ctx.selection,
					ctx.getDoc(),
					ctx.reading.grammar,
					el,
					myPath,
					'start'
				);
				scrollFocusBlockIntoView(ctx.selection, ctx.scrollOwner);
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
		if (isAtLastVisualLine(el, offset, bounds())) {
			// Cross the boundary only when focus is already at the block's last reachable
			// offset, so native Shift+ArrowDown extension has nowhere left to go.
			if (e.shiftKey && offset >= bounds().end) {
				e.preventDefault();
				extendFocusToNextBlock(
					ctx.selection,
					ctx.getDoc(),
					ctx.reading.grammar,
					el,
					myPath,
					'vertical'
				);
				scrollFocusBlockIntoView(ctx.selection, ctx.scrollOwner);
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
		// Shift+Arrow reads the focus, since `getCursorOffset()` gives the range start: the anchor
		// of a forward selection, which would extend across blocks while the focus contracts.
		const offset = e.shiftKey ? (ctx.getFocusOffset() ?? bounds().start) : ctx.getCursorOffset();
		if (offset !== null && offset <= bounds().start) {
			if (e.shiftKey) {
				e.preventDefault();
				extendFocusToPreviousBlock(ctx.selection, ctx.getDoc(), ctx.reading.grammar, el, myPath);
				scrollFocusBlockIntoView(ctx.selection, ctx.scrollOwner);
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
				extendFocusToNextBlock(ctx.selection, ctx.getDoc(), ctx.reading.grammar, el, myPath);
				scrollFocusBlockIntoView(ctx.selection, ctx.scrollOwner);
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

/** The reads the bounds need, so a block-edge check outside this file can ask without building
 *  the whole keydown context. */
export interface LandableBoundsContext {
	/** textContent length in raw-content coordinates (the marker prefix excluded). */
	getTextLen(): number;
}

/** The raw offsets a caret can reach in the block, from the same walk that places it: hidden
 *  markers put bytes out of reach, so every block-edge check reads this, not 0 and length. */
export function caretLandableBounds(ctx: LandableBoundsContext, el: HTMLElement): LandableBounds {
	return landableRawBounds(el) ?? { start: 0, end: ctx.getTextLen() };
}
