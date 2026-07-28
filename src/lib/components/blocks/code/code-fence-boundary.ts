/**
 * Pure decisions for Backspace/Delete at the fence/body boundary of a
 * fenced code block. The opener fence (` ```... ` + its trailing `\n`)
 * and closer fence (leading `\n` + ` ```... `) are not editable content —
 * deletions that would consume those characters merge the body into a
 * fence line and silently corrupt the structure. Re-routes those keystrokes
 * to a focus-move out of the block, matching the offset-0 / offset-end exit
 * semantics.
 *
 * Display-text coordinates throughout (textContent of the contenteditable;
 * raw without the trailing line ending). Mirrors `code-fence-exit.ts`.
 */

import type { NodeView } from '../../../core/node-views';
import { displayLength } from '../../../core/lines';
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
 * Clamp a whole range onto the body, for the gestures that rewrite entire LINES
 * (Tab indent, Shift+Tab dedent). The fence lines are structure, not content: a
 * tab on the closer pushes it past GFM's 3-space limit so it stops closing the
 * block, and the fence then absorbs the rest of the document on reload; a tab on
 * the opener demotes the whole block to an indented code block. Both survive the
 * live session looking fine — the corruption lands at the next parse.
 */
export function clampRangeToBody(node: NodeView, range: CodeRange): CodeRange {
	const bounds = fenceBodyBounds(sliceFencedCode(node));
	// A fence with no body line yet (` ``` ` plus its ending) has a body start past
	// the display text, so the block's own end is the floor everything collapses to.
	const displayEnd = displayLength(node.raw);
	const lo = Math.min(bounds.start, displayEnd);
	const hi = Math.min(Math.max(bounds.end, lo), displayEnd);
	const clamp = (offset: number) => Math.min(Math.max(offset, lo), hi);
	return { start: clamp(range.start), end: clamp(range.end) };
}

// ── Internal ────────────────────────────────────────────────────────────────

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
