/**
 * The caret keys the editor lands itself instead of the browser, the same on every engine: a
 * horizontal character, word or line-edge key (`caret/caret-motion.ts` names the target), its Shift
 * twin selecting what the matching delete takes, and a vertical arrow from beside a widget. Each
 * landing is checked against the browser's own move (G1.163) and scrolled into view.
 */

import type { CaretWriter } from '../browser/caret-writer';
import { widgetTouching } from '../browser/painted';
import { holdsNativeRange, rawSelectionIn, readNativeSelection } from '../browser/selection-read';
import { lineStepBesideWidget, WIDGET_SHELLS } from '../browser/visual-lines';
import { motionTarget, type CaretUnitSource } from '../caret/caret-motion';
import type { DeleteContext } from '../caret/delete-extent';
import { widgetSourceRange } from '../core/inline/widget-shell';
import { hasWordSegmenter } from '../core/text-units';
import type { MotionKey } from '../schema/keybindings';
import { usesMacEditingConventions } from '../schema/platform-conventions';
import type { ScrollOwner } from '../windowing/scroll-owner';
import type { CaretLanding } from './caret-landing';
import { extendWithinBlock } from './keyboard-extend';
import type { SelectionState } from './selection-state.svelte';
import { showCaret } from './show-caret';

// ── Public API ─────────────────────────────────────────────────────────────

/** What a block's keydown hands the caret keys the editor lands. */
export interface MotionKeyContext {
	/** Current caret offset in raw-content coordinates (the container's marker prefix excluded). */
	getCursorOffset(): number | null;
	/** Shift-selection focus offset in raw-content coordinates (the marker prefix excluded). */
	getFocusOffset(): number | null;
	selection: Pick<SelectionState, 'isCrossBlock'>;
	caretWriter: CaretWriter;
	/** Shows each end a Shift+Arrow moves, and restores a range folded back into one block. */
	caretLanding: Pick<CaretLanding, 'restore' | 'showSelectionEnd'>;
	scroll: Pick<ScrollOwner, 'showRect'>;
	/** The spans in this block a caret can't stop inside, which a horizontal arrow crosses whole. */
	caretUnits: CaretUnitSource;
	/** What the block's delete reads at `caret`, which a word or edge key lands by too; null where
	 *  the block leaves those keys to the browser. */
	unitContext(caret: number): DeleteContext | null;
}

/** A horizontal caret key the editor lands itself, its Shift twin selecting what the matching
 *  delete takes. True if it did. */
export function handleMotion(
	e: KeyboardEvent,
	key: MotionKey,
	ctx: MotionKeyContext,
	el: HTMLElement
): boolean {
	if (ctx.selection.isCrossBlock) return false;
	// Over a range a Mac's Cmd+Shift+Arrow grows the range's own end, the platform's way, left to it.
	if (key.arrow && key.extend && usesMacEditingConventions() && heldRange(el)) return false;
	if (key.unit === 'word' && !hasWordSegmenter()) return false;
	// With Shift the moving end; over a range, its edge on the key's side, as a plain arrow collapses it.
	const held = key.extend ? null : heldRange(el);
	const edges = held && held.start !== null && held.end !== null ? held : null;
	const from = key.extend
		? ctx.getFocusOffset()
		: edges
			? edges[key.direction === 'backward' ? 'start' : 'end']
			: ctx.getCursorOffset();
	if (from === null) return false;
	const context = key.unit === 'character' ? null : ctx.unitContext(from);
	if (key.unit !== 'character' && (!context || readsRightToLeft(context.text, from))) return false;
	const motion = { caret: from, units: ctx.caretUnits, extending: key.extend, block: context };
	if (key.unit === 'line-edge' && context) {
		// A block nothing lays out has no line to find the edge of, so the key stays the browser's.
		if (el.getClientRects().length === 0) return false;
		e.preventDefault();
		moveToLineEdge(key, ctx, el, from, context.text, () => motionTarget(key, motion));
		decided(ctx, el);
		return true;
	}
	const target = motionTarget(key, motion);
	if (target === null) return false;
	e.preventDefault();
	if (key.extend) extendWithinBlock(ctx, el, target);
	else
		ctx.caretWriter.placeCaretAtRaw(el, target, {
			clamp: key.unit === 'character' ? 'exact' : 'reachable'
		});
	if (key.unit === 'character') ctx.caretUnits.crossed();
	decided(ctx, el);
	return true;
}

/** A plain vertical arrow from a caret touching a widget on another line, which the editor places
 *  since an engine can read that spot on the wrong line. True if it did. */
export function stepBesideWidget(
	e: KeyboardEvent,
	ctx: Pick<MotionKeyContext, 'caretWriter' | 'scroll'>,
	el: HTMLElement,
	direction: 'up' | 'down'
): boolean {
	if (e.ctrlKey || e.metaKey) return false;
	const target = lineStepBesideWidget(el, direction);
	if (target === null) return false;
	e.preventDefault();
	ctx.caretWriter.placeCaretAtRaw(el, target, { clamp: 'reachable' });
	decided(ctx, el);
	return true;
}

// ── Internals ──────────────────────────────────────────────────────────────

/** A caret key the editor landed: the check that the browser's own move didn't run as well, and
 *  the scroll that move would have made to show the caret. */
function decided(ctx: Pick<MotionKeyContext, 'caretWriter' | 'scroll'>, el: HTMLElement): void {
	ctx.caretWriter.noteDecidedMotion();
	showCaret(el, ctx.scroll);
}

/** The range the selection holds in `el`; null for a caret, which costs no walk of the block. */
function heldRange(el: HTMLElement): ReturnType<typeof rawSelectionIn> {
	const range = holdsNativeRange() ? rawSelectionIn(el) : null;
	return range && !range.collapsed ? range : null;
}

/** The line's edge by the browser's own move, which keeps a soft wrap's side; `target` (a layout
 *  read, so asked only with a widget drawn) where a widget or line break parts them. */
function moveToLineEdge(
	key: MotionKey,
	ctx: MotionKeyContext,
	el: HTMLElement,
	from: number,
	text: string,
	target: () => number | null
): void {
	const side = key.direction === 'backward' ? 'start' : 'end';
	const writer = ctx.caretWriter;
	const asked = !caretTouchesWidget(el);
	const drawsWidget = el.querySelector(WIDGET_SHELLS) !== null;
	const strays = (landed: number | null, at: number) =>
		landed === null || widgetBetween(el, landed, at) || breakBetween(text, landed, at);
	if (key.extend) {
		if (asked) writer.extendToLineEdge(side);
		if (!drawsWidget) return;
		const at = target();
		if (at !== null && strays(asked ? ctx.getFocusOffset() : null, at)) {
			extendWithinBlock(ctx, el, at);
		}
		return;
	}
	// A range collapses first; a caret is left as it stands, since writing it drops its side.
	if (from !== ctx.getCursorOffset()) writer.placeCaretAtRaw(el, from, { clamp: 'reachable' });
	if (asked) writer.moveCaretToLineEdge(side);
	if (!drawsWidget) return;
	const at = target();
	if (at === null) return;
	const keep = !strays(asked ? ctx.getCursorOffset() : null, at);
	// A line start before a widget is written on the widget's line, which a text position isn't.
	if (keep && !(side === 'start' && caretTouchesWidget(el))) return;
	writer.placeCaretAtRaw(el, at, {
		clamp: 'reachable',
		line: side === 'start' ? 'later' : undefined
	});
}

/** Whether a hard line break sits between raw offsets `a` and `b` of `text`. */
function breakBetween(text: string, a: number, b: number): boolean {
	return /[\r\n]/.test(text.slice(Math.min(a, b), Math.max(a, b)));
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
	for (const shell of el.querySelectorAll(WIDGET_SHELLS)) {
		const start = widgetSourceRange(shell)?.start;
		if (start !== undefined && start >= low && start < high) return true;
	}
	return false;
}

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
