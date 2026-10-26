/**
 * Shared keydown prelude for contenteditable blocks: Ctrl+A counter, cross-block dispatch,
 * the caret memory's key note, undo/redo, arrow boundary navigation. Block-specific handlers
 * (Enter, Backspace, Tab, formatting) stay in each component.
 */

import type { FocusActions, HistoryActions } from '../action-contracts';
import type { DocumentGetter } from '../editor-keys';
import type { CaretMemory } from '../caret/caret-memory';
import type { CaretLanding } from './caret-landing';
import type { SelectionState } from './selection-state.svelte';
import type { CaretWriter } from '../browser/caret-writer';
import type { CrossBlockHandlers } from './cross-block/dispatch';
import type { CommandDispatchContext } from '../schema/block-commands';
import { commandAtBlock, isArrowKey } from './cross-block/keydown';
import { holdsNativeRange, rawSelectionIn } from '../browser/selection-read';
import type { Reading } from '../schema/reading';
import {
	extendFocusToNextBlock,
	extendFocusToPreviousBlock,
	extendWithinBlock
} from './keyboard-extend';
import { getCurrentCursorEditorRelativeX } from '../caret/sticky-measure';
import {
	landableEndAbutsIsland,
	landableRawBounds,
	landableStartAbutsIsland
} from '../browser/offsets';
import { markerPrefixOf } from '../browser/painted';
import { isAtFirstVisualLine, isAtLastVisualLine, lineHeightOf } from '../browser/lines';
import {
	caretEdgeKey,
	endsSelectAllRun,
	eventToChord,
	type CaretEdgeKey
} from '../schema/keybindings';
import { isDefaultGlobalChord } from '../schema/commands';
import type { ScrollOwner } from '../windowing/scroll-owner';

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
	caretWriter: CaretWriter;
	caretMemory: CaretMemory;
	history: HistoryActions;
	focus: FocusActions;
	/** Shows each end a Shift+Arrow moves, and restores a range folded back into one block. */
	caretLanding: Pick<CaretLanding, 'restore' | 'showSelectionEnd'>;
	/** The editor's command dispatch: the caret memory reads a chord by its current binding, and
	 *  the history suppression below takes only this editor's plugin chords. */
	commands: CommandDispatchContext;
	/** How the editor reads its bytes, whose grammar the vertical extension skips leaves by. */
	reading: Reading;
	/** What the editor shows, and the one scroll a key may ask for (a tall block with no caret). */
	scroll: Pick<ScrollOwner, 'visibleBand' | 'showRect'>;
	/** A plain horizontal arrow at a hidden construct edge: true when the press moved which side
	 *  of the edge the caret means instead of moving the caret (live-mode.md § 4.2). */
	stepEdge?(e: KeyboardEvent): boolean;
	/** The spans in this block a caret can't stop inside, which a horizontal arrow crosses whole. */
	caretUnits: CaretUnitSource;
}

/** A raw `[start, end)` a caret can't stop inside: a widget, a replace decoration, a CRLF pair. */
export interface CaretUnit {
	start: number;
	end: number;
}

export interface CaretUnitSource {
	/** The span `offset` sits against or inside, on the side `direction` names. A plain arrow
	 *  crosses only the spans that read as one character; `extending`, every span. */
	beside(offset: number, direction: 'forward' | 'backward', extending: boolean): CaretUnit | null;
	/** Called once a press crossed a span: the widget edge a click held stops naming the caret. */
	crossed(): void;
}

/** True when the event was fully handled; the caller must skip its block-specific branches. */
export async function handleSharedKeydown(
	e: KeyboardEvent,
	ctx: SharedKeydownContext
): Promise<boolean> {
	if (endsSelectAllRun(e)) ctx.selection.resetSelectAllCount();

	// Before the cross-block dispatch and the caret memory, which would record the press as a step.
	if (handleEdgeStep(e, ctx)) return true;

	if (await ctx.crossBlock.handleKeyDown(e)) return true;

	const el = ctx.getEl();
	if (!el) return false;

	// Before the key note, which measures a vertical arrow's column at the collapsed caret.
	const collapsedRange = collapseRangeForArrow(e, ctx, el);

	ctx.caretMemory.noteKey(e, commandAtBlock(e, ctx), () =>
		getCurrentCursorEditorRelativeX(el, ctx.caretWriter)
	);

	const horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
	// A horizontal arrow over a range only collapses it; a vertical one moves on from there.
	if (collapsedRange && horizontal) {
		e.preventDefault();
		return true;
	}

	// Ctrl+Y fires no `historyRedo` beforeinput in Chromium and WebView2, so every chord with a
	// native history default is suppressed here; the block's own dispatch runs the command.
	const historyChord = eventToChord(e);
	if (historyChord && isDefaultGlobalChord(historyChord, ctx.commands.activation)) {
		e.preventDefault();
		return false;
	}

	// Cmd+Arrow is a caret-edge key, never a step: only the edge sites read it.
	const edge = caretEdgeKey(e);
	if (handleBlockEdgeChord(e, edge, ctx, el)) return true;
	if (edge) return false;

	// The moving end, read once for the span step and the boundary check: with Shift the focus, since
	// a forward range's start is its anchor, which extends across blocks while the focus contracts.
	const stepOffset = !horizontal ? null : e.shiftKey ? ctx.getFocusOffset() : ctx.getCursorOffset();

	// After the key note, so the press still resets the sticky column as any horizontal step does.
	if (horizontal && handleUnitStep(e, ctx, el, stepOffset)) return true;

	// ── Arrow boundary navigation ─────────────────────────────────────────
	const index = ctx.getIndex();
	const myPath = ctx.getMyPath();
	// Lazy: off the arrow path the block's bounds are never asked for, and the resolve
	// walks the block's DOM.
	let cachedBounds: LandableBounds | null = null;
	const bounds = () => (cachedBounds ??= caretLandableBounds(ctx, el));

	// The moving end, which the line check measures (a forward extension's anchor stays mid-block);
	// with no caret in the block, as in reading mode, every arrow is at its edge.
	const verticalOffset = () => ctx.getFocusOffset() ?? ctx.getCursorOffset();

	// A Shift extension crosses the boundary only from the block's first or last reachable offset,
	// so the browser's own extension has nowhere left to go within it; no line read decides it.
	if (e.key === 'ArrowUp') {
		const offset = verticalOffset();
		if (e.shiftKey) {
			if (offset !== null && offset <= bounds().start) {
				e.preventDefault();
				extendFocusToPreviousBlock(ctx, el, myPath, 'start');
				return true;
			}
		} else if (
			!e.altKey &&
			(offset === null || isAtFirstVisualLine(el, offset, bounds(), ctx.caretWriter))
		) {
			e.preventDefault();
			void ctx.focus.moveFocus(index - 1, { stickyColumnFrom: 'below' });
			return true;
		}
	}

	if (e.key === 'ArrowDown') {
		const offset = verticalOffset();
		if (e.shiftKey) {
			if (offset !== null && offset >= bounds().end) {
				e.preventDefault();
				extendFocusToNextBlock(ctx, el, myPath, 'vertical');
				return true;
			}
		} else if (
			!e.altKey &&
			(offset === null || isAtLastVisualLine(el, offset, bounds(), ctx.caretWriter))
		) {
			e.preventDefault();
			if (offset === null && scrollsThroughBlock(ctx, el)) return true;
			void ctx.focus.moveFocus(index + 1, { stickyColumnFrom: 'above' });
			return true;
		}
	}

	if (e.key === 'ArrowLeft') {
		const offset = e.shiftKey ? (stepOffset ?? bounds().start) : stepOffset;
		if (offset === null || offset <= bounds().start) {
			if (e.shiftKey) {
				e.preventDefault();
				extendFocusToPreviousBlock(ctx, el, myPath);
				return true;
			}
			e.preventDefault();
			void ctx.focus.moveFocus(index - 1, 'end');
			return true;
		}
	}

	if (e.key === 'ArrowRight') {
		const offset = e.shiftKey ? (stepOffset ?? bounds().end) : stepOffset;
		if (offset === null || offset >= bounds().end) {
			if (e.shiftKey) {
				e.preventDefault();
				extendFocusToNextBlock(ctx, el, myPath);
				return true;
			}
			e.preventDefault();
			void ctx.focus.moveFocus(index + 1, 'start');
			return true;
		}
	}

	return false;
}

/** A plain arrow over a range in the block collapses it ahead of every check that could leave the
 *  block: Left to its start, Right to its end, Up and Down to its moving end. True if it did. */
function collapseRangeForArrow(
	e: KeyboardEvent,
	ctx: SharedKeydownContext,
	el: HTMLElement
): boolean {
	if (!isArrowKey(e.key) || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) {
		return false;
	}
	// A caret, the common case, costs no walk of the block.
	if (!holdsNativeRange()) return false;
	const range = rawSelectionIn(el);
	if (!range || range.collapsed || range.start === null || range.end === null) return false;
	const at =
		e.key === 'ArrowLeft' ? range.start : e.key === 'ArrowRight' ? range.end : ctx.getFocusOffset();
	if (at === null) return false;
	// Reading mode declines the caret and drops the range, leaving the arrow at the block's edge.
	return ctx.caretWriter.placeCaretAtRaw(el, at, { clamp: 'reachable' });
}

/** ArrowDown with no caret in a block running past the editor's bottom edge scrolls one line
 *  instead of leaving it, so a reader reads the whole block. True when it scrolled. */
function scrollsThroughBlock(ctx: SharedKeydownContext, el: HTMLElement): boolean {
	const band = ctx.scroll.visibleBand();
	const bottom = el.getBoundingClientRect().bottom;
	if (!band || bottom <= band.bottom + 1) return false;
	const line = Math.min(lineHeightOf(el), bottom - band.bottom);
	ctx.scroll.showRect(() => {
		const now = ctx.scroll.visibleBand();
		return now && new DOMRect(0, now.bottom, 1, line);
	});
	return true;
}

/** A plain arrow at a hidden construct edge moves the side the caret means, not the caret
 *  (live-mode.md § 4.2). Runs ahead of everything that reads the press as a step; true if claimed. */
export function handleEdgeStep(
	e: KeyboardEvent,
	ctx: Pick<SharedKeydownContext, 'selection' | 'stepEdge'>
): boolean {
	if (ctx.selection.isCrossBlock || !ctx.stepEdge) return false;
	let stepped = edgeStepByEvent.get(e);
	if (stepped === undefined) {
		stepped = ctx.stepEdge(e);
		edgeStepByEvent.set(e, stepped);
	}
	if (stepped) e.preventDefault();
	return stepped;
}

// A table cell asks ahead of its navigation plan as well as here, so each event is read once.
const edgeStepByEvent = new WeakMap<KeyboardEvent, boolean>();

/** A horizontal arrow beside a span the caret can't stop inside lands at its far edge in one press,
 *  decided here because WebKit and Firefox step natively into or past one. True if claimed. */
function handleUnitStep(
	e: KeyboardEvent,
	ctx: SharedKeydownContext,
	el: HTMLElement,
	offset: number | null
): boolean {
	if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || ctx.selection.isCrossBlock) {
		return false;
	}
	const extending = e.shiftKey;
	if (offset === null) return false;
	const direction = e.key === 'ArrowRight' ? 'forward' : 'backward';
	const unit = ctx.caretUnits.beside(offset, direction, extending);
	if (!unit) return false;
	e.preventDefault();
	const target = direction === 'forward' ? unit.end : unit.start;
	if (extending) extendWithinBlock(ctx, el, target);
	else ctx.caretWriter.placeCaretAtRaw(el, target, { clamp: 'exact' });
	ctx.caretUnits.crossed();
	return true;
}

/** A block-edge key lands on the text's edge wherever the browser's own wouldn't: past a marker or
 *  a widget at that end (Firefox stops short of one), and for Cmd+Arrow, which only macOS moves. */
function handleBlockEdgeChord(
	e: KeyboardEvent,
	edge: CaretEdgeKey | null,
	ctx: SharedKeydownContext,
	el: HTMLElement
): boolean {
	if (edge?.to !== 'block' || ctx.selection.isCrossBlock) return false;
	const toEnd = edge.side === 'end';
	const guarded = toEnd
		? landableEndAbutsIsland(el)
		: markerPrefixOf(el) !== null || landableStartAbutsIsland(el);
	if (!guarded && !edge.arrow) return false;
	e.preventDefault();
	const bounds = caretLandableBounds(ctx, el);
	ctx.caretWriter.placeCaretAtRaw(el, toEnd ? bounds.end : bounds.start, { clamp: 'reachable' });
	return true;
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
