/**
 * Pure decisions that keep an edit off the fence lines of a fenced code block.
 * The opener fence (` ```... ` + its trailing `\n`) and closer fence (leading
 * `\n` + ` ```... `) are structure, not editable content — an edit that consumes
 * either line ending merges the body into a fence line and leaves an unclosed
 * fence that absorbs the rest of the document at the next parse. Two tiers:
 * a keystroke at the boundary re-routes to a focus-move out of the block
 * (`classifyFenceBoundary`), and anything that rewrites a range is re-sited onto
 * the body window (`fenceEditSpan` and the clamps around it).
 *
 * Display-text coordinates throughout (textContent of the contenteditable;
 * raw without the trailing line ending). Mirrors `code-fence-exit.ts`.
 */

import type { NodeView } from '../../../core/node-views';
import { displayLength, trimTrailingLineEnding } from '../../../core/lines';
import { sliceFencedCode } from './code-renderer';

// ── Public API ──────────────────────────────────────────────────────────────

export interface FenceBoundaryInput {
	node: NodeView;
	offset: number;
	/** True when the user pressed Delete (forward) rather than Backspace. */
	forward: boolean;
}

/** Display-text offset range, as the code gestures pass it around. */
export interface CodeRange {
	start: number;
	end: number;
}

export type FenceBoundaryResult =
	| { kind: 'allow' } // native edit is safe
	| { kind: 'exitPrev' } // crossing the opener boundary backward
	| { kind: 'exitNext' }; // crossing the closer boundary forward

/**
 * Classify a Backspace/Delete keystroke against the fence/body boundary.
 *
 * The corruption this guards against is structural: deleting either of the
 * two `\n` characters that demarcate the body from the fence lines re-parses
 * the block in a different shape (opener fuses with body; closer drifts off
 * column 0). Other in-block edits — typing info-string chars, deleting an
 * opener backtick mid-typing, etc. — are allowed; they round-trip through
 * the parser cleanly.
 *
 *   Backspace at offset == bodyStart (when opener terminates with `\n`)
 *       → exitPrev (would delete the opener's terminating `\n`)
 *   Delete    at offset == bodyEnd   (when closer is present)
 *       → exitNext (would delete the body's terminating `\n`)
 *   everything else → allow (native edit OK).
 *
 * `bodyStart` is the post-opener offset; `bodyEnd` is the pre-closer offset
 * (just before the `\n` that introduces the closer line).
 */
export function classifyFenceBoundary(input: FenceBoundaryInput): FenceBoundaryResult {
	const { node, offset, forward } = input;

	const slice = sliceFencedCode(node);
	const { start: bodyStart, end: bodyEnd } = fenceBodyBounds(slice);

	if (!forward) {
		if (slice.openerLine.endsWith('\n') && offset === bodyStart) return { kind: 'exitPrev' };
		return { kind: 'allow' };
	}
	if (slice.closerLine.length > 0 && offset === bodyEnd) return { kind: 'exitNext' };
	return { kind: 'allow' };
}

/**
 * Clamp an Enter-splice offset out of the opener line. A `\n` spliced before
 * or inside the opener text re-shapes the fence (`sliceFencedCode` renders a
 * phantom fence from a leading `\n`), so those carets clamp to the body start
 * — Enter there behaves exactly like Enter at body-line-1 start. The end of
 * the opener text is left alone: splicing after the full fence+info string is
 * already safe and keeps its caret-on-the-new-line behavior.
 */
export function clampEnterOffsetToBody(node: NodeView, offset: number): number {
	const openerLine = sliceFencedCode(node).openerLine;
	const openerTextEnd = openerLine.endsWith('\n') ? openerLine.length - 1 : openerLine.length;
	return offset < openerTextEnd ? openerLine.length : offset;
}

/**
 * Clamp a whole range onto the body, unconditionally — for the gestures that
 * rewrite entire LINES (Tab indent, Shift+Tab dedent). The fence lines are
 * structure, not content: a tab on the closer pushes it past GFM's 3-space limit
 * so it stops closing the block, and the fence then absorbs the rest of the
 * document on reload; a tab on the opener demotes the whole block to an indented
 * code block. Both survive the live session looking fine — the corruption lands at
 * the next parse. Gestures that rewrite an arbitrary RANGE use `fenceEditSpan`,
 * which clamps only what crosses.
 */
export function clampRangeToBody(node: NodeView, range: CodeRange): CodeRange {
	const { start: lo, end: hi } = bodyWindow(node);
	const clamp = (offset: number) => Math.min(Math.max(offset, lo), hi);
	return { start: clamp(range.start), end: clamp(range.end) };
}

/**
 * Does a pending edit's range cross out of the region it starts in? The display
 * text has three: the opener's own text, the body, and the closer's own text. An
 * edit confined to one of them round-trips through the parser — retyping an info
 * string, deleting a closer backtick mid-edit — and keeps native handling. An edit
 * that crosses consumes one of the two line endings that demarcate the body, which
 * fuses a fence line into the body and leaves an unclosed fence that absorbs every
 * following block at the next parse.
 */
export function crossesFenceBoundary(node: NodeView, range: CodeRange): boolean {
	const { openerTextEnd, body, closerTextStart } = fenceRegions(node);
	const lo = Math.min(range.start, range.end);
	const hi = Math.max(range.start, range.end);
	if (hi <= openerTextEnd) return false;
	if (lo >= body.start && hi <= body.end) return false;
	return lo < closerTextStart;
}

/**
 * The span a ranged edit actually rewrites: the selection itself while it stays
 * inside one region, its intersection with the body once it crosses. Fence lines
 * are never rewritten, so a selection made entirely of fence characters yields an
 * empty span and the gesture has nothing to apply.
 */
export function fenceEditSpan(node: NodeView, range: CodeRange): CodeRange {
	const ordered = {
		start: Math.min(range.start, range.end),
		end: Math.max(range.start, range.end)
	};
	return crossesFenceBoundary(node, ordered) ? clampRangeToBody(node, ordered) : ordered;
}

/**
 * The one splice every gesture that rewrites a range on this surface goes through
 * — native delete/type-over (via the beforeinput guard), cut, and paste's
 * pre-delete: `insert` replaces the edit span, `''` for a delete. Null when the
 * clamped edit rewrites nothing, so a fence-only selection commits no CST edit and
 * spends no undo entry.
 */
export function computeFenceRangedEdit(
	node: NodeView,
	range: CodeRange,
	insert: string
): FenceRangedEdit | null {
	const display = trimTrailingLineEnding(node.raw);
	const span = fenceEditSpan(node, range);
	const newText = display.slice(0, span.start) + insert + display.slice(span.end);
	if (newText === display) return null;
	return { newText, newCursor: span.start + insert.length };
}

export interface FenceRangedEdit {
	newText: string;
	newCursor: number;
}

// ── Internal ────────────────────────────────────────────────────────────────

interface FenceRegions {
	/** End of the opener's own text, before the line ending that starts the body. */
	openerTextEnd: number;
	body: CodeRange;
	/** Start of the closer's own text, past the body's line ending. */
	closerTextStart: number;
}

function fenceRegions(node: NodeView): FenceRegions {
	const slice = sliceFencedCode(node);
	const displayEnd = displayLength(node.raw);
	const body = bodyWindow(node);
	return {
		openerTextEnd: Math.min(displayLength(slice.openerLine), displayEnd),
		body,
		// `slice.body` carries its own trailing ending, so its full length is where the
		// closer line begins; an unclosed fence has no closer and collapses onto the end.
		closerTextStart: Math.min(body.start + slice.body.length, displayEnd)
	};
}

function bodyWindow(node: NodeView): CodeRange {
	const bounds = fenceBodyBounds(sliceFencedCode(node));
	// A fence with no body line yet (` ``` ` plus its ending) has a body start past
	// the display text, so the block's own end is the floor everything collapses to.
	const displayEnd = displayLength(node.raw);
	const start = Math.min(bounds.start, displayEnd);
	return { start, end: Math.min(Math.max(bounds.end, start), displayEnd) };
}

/**
 * The body's display-text bounds: `[start, end)` spans the content lines and
 * excludes both fence lines. `end` reads the body's own trailing ending through
 * `displayLength` — the old `closerStart - 1` assumed a one-character ending, so
 * in a CRLF document the boundary landed BETWEEN the `\r` and the `\n`.
 */
function fenceBodyBounds(slice: ReturnType<typeof sliceFencedCode>): CodeRange {
	const start = slice.openerLine.length;
	return { start, end: start + displayLength(slice.body) };
}
