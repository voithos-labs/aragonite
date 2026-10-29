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
import { landableRawBounds } from '../browser/offsets';
import { widgetTouching } from '../browser/painted';
import { readNativeSelection } from '../browser/selection-read';
import { motionTarget, type CaretUnitSource } from '../caret/caret-motion';
import type { DeleteContext } from '../caret/delete-extent';
import { hasWordSegmenter } from '../core/text-units';
import { usesMacEditingConventions } from '../schema/platform-conventions';
import {
	isAtFirstVisualLine,
	isAtLastVisualLine,
	lineHeightOf,
	lineStepBesideWidget
} from '../browser/visual-lines';
import {
	caretEdgeKey,
	endsSelectAllRun,
	eventToChord,
	motionKey,
	type MotionKey
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
	/** What the block's delete reads at `caret`, which a word or edge key lands by too; null where
	 *  the block leaves those keys to the browser. */
	unitContext(caret: number): DeleteContext | null;
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

	// After the key note, so the press still resets the sticky column as any horizontal step does.
	const motion = motionKey(e);
	if (motion && handleMotion(e, motion, ctx, el)) return true;
	// A caret-edge key the editor left alone (Cmd+Up and Down, a line nothing lays out) is the
	// browser's, never a step across blocks.
	if (caretEdgeKey(e)) return false;

	// The moving end, read for the boundary check: with Shift the focus, since a forward range's
	// start is its anchor, which extends across blocks while the focus contracts.
	const stepOffset = !horizontal ? null : e.shiftKey ? ctx.getFocusOffset() : ctx.getCursorOffset();

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
		} else if (!e.altKey && stepBesideWidget(e, ctx, el, 'up')) {
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
		} else if (!e.altKey && stepBesideWidget(e, ctx, el, 'down')) {
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
	if (!isArrowKey(e.key) || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false;
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

/** A plain vertical arrow from a caret touching a widget on another line, which the editor places
 *  since an engine can read that spot on the wrong line. True if it did. */
function stepBesideWidget(
	e: KeyboardEvent,
	ctx: SharedKeydownContext,
	el: HTMLElement,
	direction: 'up' | 'down'
): boolean {
	if (e.ctrlKey || e.metaKey) return false;
	const target = lineStepBesideWidget(el, direction);
	if (target === null) return false;
	e.preventDefault();
	ctx.caretWriter.placeCaretAtRaw(el, target, { clamp: 'reachable' });
	ctx.caretWriter.noteDecidedMotion();
	return true;
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

/** A horizontal caret key the editor lands itself (`caret/caret-motion.ts`), the same on every
 *  engine, its Shift twin selecting what the matching delete takes. True if it did. */
function handleMotion(
	e: KeyboardEvent,
	key: MotionKey,
	ctx: SharedKeydownContext,
	el: HTMLElement
): boolean {
	if (ctx.selection.isCrossBlock) return false;
	// Over a range a Mac's Cmd+Shift+Arrow grows the range's own end, the platform's way, left to it.
	if (key.arrow && key.extend && usesMacEditingConventions() && heldRangeIn(el)) return false;
	if (key.unit === 'word' && !hasWordSegmenter()) return false;
	const from = motionStart(key, ctx, el);
	if (from === null) return false;
	const context = key.unit === 'character' ? null : ctx.unitContext(from);
	if (key.unit !== 'character' && (!context || readsRightToLeft(context.text, from))) return false;
	const target = motionTarget(key, {
		caret: from,
		units: ctx.caretUnits,
		extending: key.extend,
		block: context
	});
	if (target === null) return false;
	e.preventDefault();
	if (key.unit === 'line-edge') moveToLineEdge(key, ctx, el, from, target);
	else if (key.extend) extendWithinBlock(ctx, el, target);
	else
		ctx.caretWriter.placeCaretAtRaw(el, target, {
			clamp: key.unit === 'character' ? 'exact' : 'reachable'
		});
	if (key.unit === 'character') ctx.caretUnits.crossed();
	ctx.caretWriter.noteDecidedMotion();
	return true;
}

function heldRangeIn(el: HTMLElement): boolean {
	const range = holdsNativeRange() ? rawSelectionIn(el) : null;
	return !!range && !range.collapsed;
}

/** Where a caret key moves from: with Shift the moving end; over a range, its edge on the key's
 *  side, as a plain arrow collapses it; else the caret. */
function motionStart(key: MotionKey, ctx: SharedKeydownContext, el: HTMLElement): number | null {
	if (key.extend) return ctx.getFocusOffset();
	const range = holdsNativeRange() ? rawSelectionIn(el) : null;
	if (range && !range.collapsed && range.start !== null && range.end !== null) {
		return key.direction === 'backward' ? range.start : range.end;
	}
	return ctx.getCursorOffset();
}

/** The line's edge by the browser's own line move, which keeps the side of a soft wrap the caret
 *  shows on; the editor's where a widget stands between the two or touches the caret. */
function moveToLineEdge(
	key: MotionKey,
	ctx: SharedKeydownContext,
	el: HTMLElement,
	from: number,
	target: number
): void {
	const side = key.direction === 'backward' ? 'start' : 'end';
	const writer = ctx.caretWriter;
	const asked = !caretTouchesWidget(el);
	if (key.extend) {
		if (asked) writer.extendToLineEdge(side);
		const landed = asked ? ctx.getFocusOffset() : null;
		if (landed === null || widgetBetween(el, landed, target)) extendWithinBlock(ctx, el, target);
		return;
	}
	// A range collapses first; a caret is left as it stands, since writing it drops its side.
	if (from !== ctx.getCursorOffset()) writer.placeCaretAtRaw(el, from, { clamp: 'reachable' });
	if (asked) writer.moveCaretToLineEdge(side);
	const landed = asked ? ctx.getCursorOffset() : null;
	const keep = landed !== null && !widgetBetween(el, landed, target);
	// A line start before a widget is written on the widget's line, which a text position isn't.
	if (keep && !(side === 'start' && caretTouchesWidget(el))) return;
	writer.placeCaretAtRaw(el, target, {
		clamp: 'reachable',
		line: side === 'start' ? 'later' : undefined
	});
}

/** Whether the live caret is a collapsed position touching a widget, which can name two lines. */
function caretTouchesWidget(el: HTMLElement): boolean {
	const live = readNativeSelection();
	return !!live?.collapsed && widgetTouching(el, live.focus.node, live.focus.offset) !== null;
}

/** Whether a widget or a decoration sits between raw offsets `a` and `b` in `el`. */
function widgetBetween(el: HTMLElement, a: number, b: number): boolean {
	if (a === b) return false;
	const [low, high] = a < b ? [a, b] : [b, a];
	for (const shell of el.querySelectorAll<HTMLElement>(WIDGET_SHELLS)) {
		const start = Number(shell.dataset.sourceStart);
		if (start >= low && start < high) return true;
	}
	return false;
}

const WIDGET_SHELLS = '[data-inline-widget], [data-decoration-island]';

// Hebrew, Arabic and the scripts beside them, whose arrows move visually; nothing reads direction yet.
const RIGHT_TO_LEFT = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/;
const RTL_WINDOW = 256;

/** Whether the caret's line, within a window around it, holds right-to-left text. */
function readsRightToLeft(text: string, caret: number): boolean {
	const from = Math.max(text.lastIndexOf('\n', caret - 1) + 1, caret - RTL_WINDOW);
	const lineEnd = text.indexOf('\n', caret);
	const to = Math.min(lineEnd === -1 ? text.length : lineEnd, caret + RTL_WINDOW);
	return RIGHT_TO_LEFT.test(text.slice(from, to));
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
