/**
 * Pure decisions that keep an edit off the fence lines of a fenced code block.
 * The opener fence (` ```... ` + its trailing `\n`) and closer fence (leading
 * `\n` + ` ```... `) are structure, not editable content — an edit that rewrites
 * either leaves an unclosed fence, and an unclosed fence absorbs the rest of the
 * document at the next parse. The block's editable content is its body plus the
 * opener's info string; `crossesFenceBoundary` carries the parser evidence for
 * where that line sits. Two tiers: a keystroke at the body boundary re-routes to
 * a focus-move out of the block (`classifyFenceBoundary`), and anything that
 * rewrites a range is re-sited onto the body (`fenceEditSpan` and its clamps).
 *
 * Display-text coordinates throughout (textContent of the contenteditable;
 * raw without the trailing line ending). Mirrors `code-fence-exit.ts`.
 */

import type { NodeView } from '../../../core/node-views';
import { metadataOf } from '../../../core/nodes';
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
 * column 0). This tier answers only the two body boundaries — what else a
 * keystroke may rewrite is `crossesFenceBoundary`'s question, and the fence
 * marker runs are structure there.
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
 * Clamp an Enter-splice offset out of both fence lines. A `\n` spliced before or
 * inside the opener text re-shapes the fence (`sliceFencedCode` renders a phantom
 * fence from a leading `\n`); one spliced inside the closer text breaks the closer
 * apart, leaving an unclosed fence. Both clamp onto the nearest body edge — Enter
 * there behaves exactly like Enter at that edge. Each fence line's inner edge is
 * left alone: splicing after the full fence+info string, or at the start of the
 * closer line, is already safe and keeps its caret-on-the-new-line behavior.
 */
export function clampEnterOffsetToBody(node: NodeView, offset: number): number {
	const { openerTextEnd, body, closerTextStart } = fenceRegions(node);
	if (offset < openerTextEnd) return body.start;
	if (offset > closerTextStart) return body.end;
	return offset;
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
 * Does a pending edit's range reach out of the block's editable content? Only two
 * spans of the display text are content: the body, and the opener's info string.
 * Everything else on the two fence lines is structure, and the parser is the
 * authority on why — each of these is one keystroke away and each swallows every
 * following block into the code node at the next parse:
 *
 *   `` ```js\ncode\n`` ``     one closer backtick gone → the fence never closes
 *   `` ``js\ncode\n```  ``    one opener backtick gone → the block demotes and its
 *                             closer becomes the opener of an absorbing fence
 *   `` ```js\ncode\n``x` ``   one character typed into the closer run → same
 *   `` (4 leading spaces) ``  the opener demotes to an indented code block
 *
 * An UNCLOSED fence is the exception: with no closer to orphan, its marker run is
 * still content — demoting the block to a paragraph is how a just-typed ` ``` ` is
 * undone, and there is nothing for the demoted block to absorb.
 */
export function crossesFenceBoundary(node: NodeView, range: CodeRange): boolean {
	const { openerContent, body } = fenceRegions(node);
	const lo = Math.min(range.start, range.end);
	const hi = Math.max(range.start, range.end);
	if (lo >= openerContent.start && hi <= openerContent.end) return false;
	return !(lo >= body.start && hi <= body.end);
}

/**
 * The span a ranged edit actually rewrites: the range itself while it stays inside
 * one content region, its intersection with the body once it reaches structure.
 * Fence lines are never rewritten, so a range made entirely of structure yields an
 * empty span and the gesture has nothing to apply.
 */
export function fenceEditSpan(node: NodeView, range: CodeRange): CodeRange {
	const span = orderedRange(range);
	return crossesFenceBoundary(node, span) ? clampRangeToBody(node, span) : span;
}

/**
 * The one splice every gesture that rewrites a range on this surface goes through
 * — native delete/type-over (via the beforeinput guard), cut, and paste's
 * pre-delete: `insert` replaces the edit span, `''` for a delete. Null when there
 * is nothing to rewrite, so the gesture commits no CST edit and spends no undo
 * entry.
 */
export function computeFenceRangedEdit(
	node: NodeView,
	range: CodeRange,
	insert: string
): FenceRangedEdit | null {
	const display = trimTrailingLineEnding(node.raw);
	const ordered = orderedRange(range);
	const crossed = crossesFenceBoundary(node, ordered);
	const span = crossed ? clampRangeToBody(node, ordered) : ordered;
	// A range that reached structure and kept no body to rewrite is refused, not
	// re-sited: a character aimed at a fence must not land at the body edge, where
	// the user never pointed.
	if (crossed && span.start === span.end) return null;
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
	/**
	 * The editable span of the opener line: the info string of a closed fence, or the
	 * whole opener text while the fence is still unclosed (see `crossesFenceBoundary`).
	 */
	openerContent: CodeRange;
	body: CodeRange;
	/** Start of the closer's own text, past the body's line ending. */
	closerTextStart: number;
}

function fenceRegions(node: NodeView): FenceRegions {
	const slice = sliceFencedCode(node);
	const displayEnd = displayLength(node.raw);
	const body = bodyWindow(node);
	const openerTextEnd = Math.min(displayLength(slice.openerLine), displayEnd);
	const hasCloser = slice.closerLine.length > 0;
	const contentStart = hasCloser
		? Math.min(
				markerRunEnd(slice.openerLine, metadataOf(node, 'fencedCode').fenceMarker),
				openerTextEnd
			)
		: 0;
	return {
		openerTextEnd,
		openerContent: { start: contentStart, end: openerTextEnd },
		body,
		// `slice.body` carries its own trailing ending, so its full length is where the
		// closer line begins; an unclosed fence has no closer and collapses onto the end.
		closerTextStart: Math.min(body.start + slice.body.length, displayEnd)
	};
}

/**
 * Past the opener's indentation and its run of fence markers — where the info string
 * starts. The run's LENGTH is measured rather than read from `fenceLength`, so an
 * opener a paste has bumped to four markers is measured as four. GFM allows at most
 * three spaces of indentation (a fourth demotes the block to indented code), so a
 * longer run is not indentation to skip past: an opener line that does not have its
 * markers where the grammar puts them has no info string, and every offset on it
 * falls on the structure side.
 */
function markerRunEnd(openerLine: string, marker: string): number {
	const MAX_INDENT = 3;
	let index = 0;
	while (index < MAX_INDENT && openerLine[index] === ' ') index++;
	if (openerLine[index] !== marker) return openerLine.length;
	while (openerLine[index] === marker) index++;
	return index;
}

function orderedRange(range: CodeRange): CodeRange {
	return {
		start: Math.min(range.start, range.end),
		end: Math.max(range.start, range.end)
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
