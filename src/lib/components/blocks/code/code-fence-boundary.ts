/**
 * Pure decisions that keep an edit off the fence lines of a fenced code block: rewriting either
 * fence leaves an unclosed one that absorbs the rest of the document at the next parse. Editable
 * content is the body plus the opener's info string. Display-text coordinates throughout.
 */

import type { NodeView } from '../../../core/node-views';
import { metadataOf } from '../../../core/nodes';
import { displayLength, trimTrailingLineEnding } from '../../../core/lines';
import { sliceFencedCode, type FencedCodeSlice } from './code-renderer';

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
 * Classify a Backspace/Delete against the two body boundaries: Backspace at bodyStart
 * would delete the opener's terminating `\n`, Delete at bodyEnd the body's — either
 * re-parses the block in a different shape, so both become a focus-move out instead.
 * What else a keystroke may rewrite is `crossesFenceBoundary`'s question.
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
 * Clamp an Enter-splice out of both fence lines onto the nearest body edge — a `\n`
 * inside the opener re-shapes the fence, one inside the closer breaks it apart. Each
 * fence line's inner edge is left alone: splicing after the info string, or at the
 * start of the closer line, is already safe.
 */
export function clampEnterOffsetToBody(node: NodeView, offset: number): number {
	const { openerTextEnd, body, closerTextStart } = fenceRegions(node);
	if (offset < openerTextEnd) return body.start;
	if (offset > closerTextStart) return body.end;
	return offset;
}

/**
 * Clamp a whole range onto the body, unconditionally — for gestures that rewrite entire LINES (Tab
 * indent, Shift+Tab dedent), where a tab on the closer pushes it past GFM's 3-space limit and one
 * on the opener demotes the block. Arbitrary RANGE gestures use `fenceEditSpan` instead.
 */
export function clampRangeToBody(node: NodeView, range: CodeRange): CodeRange {
	const { start: lo, end: hi } = bodyWindow(node);
	const clamp = (offset: number) => Math.min(Math.max(offset, lo), hi);
	return { start: clamp(range.start), end: clamp(range.end) };
}

/**
 * Does a pending edit reach out of the editable content — the body, plus the opener's info string?
 * Every other offset on the fence lines is one keystroke from swallowing the following blocks into
 * the code node. An UNCLOSED fence is the exception: with no closer to orphan, its run is content
 * too, so demoting the block is how a just-typed ` ``` ` gets undone.
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
 */
export function fenceEditSpan(node: NodeView, range: CodeRange): CodeRange {
	const span = orderedRange(range);
	return crossesFenceBoundary(node, span) ? clampRangeToBody(node, span) : span;
}

/**
 * Where a caret LANDING may sit — every door that seats a caret on this surface goes
 * through here. A caret parked on a fence line takes keystrokes the guard refuses:
 * the landing looks successful and the next character disappears.
 */
export function clampCaretToBody(node: NodeView, offset: number): number {
	const caret = { start: offset, end: offset };
	if (!crossesFenceBoundary(node, caret)) return offset;
	return clampRangeToBody(node, caret).start;
}

/**
 * The refusal rule shared by every mutating gesture here: a range that reached structure and kept
 * no body after the clamp is declined, not re-sited to a body edge the user never pointed at.
 * Paste consults it directly, since it splices through the paste tree-op.
 */
export function isStructureOnlyRange(node: NodeView, range: CodeRange): boolean {
	const ordered = orderedRange(range);
	if (!crossesFenceBoundary(node, ordered)) return false;
	const span = clampRangeToBody(node, ordered);
	return span.start === span.end;
}

/**
 * The one in-place range splice — native delete/type-over (via the beforeinput guard)
 * and cut. Null when there is nothing to rewrite, so no undo entry is spent.
 */
export function computeFenceRangedEdit(
	node: NodeView,
	range: CodeRange,
	insert: string
): FenceRangedEdit | null {
	if (isStructureOnlyRange(node, range)) return null;
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
	const body = bodyWindowOf(slice, displayEnd);
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
 * Past the opener's indentation and marker run — where the info string starts. The run's LENGTH is
 * measured rather than read from `fenceLength`, so an opener a paste bumped to four markers
 * measures as four. Past GFM's 3-space indent limit there is no info string at all.
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
	return bodyWindowOf(sliceFencedCode(node), displayLength(node.raw));
}

function bodyWindowOf(slice: FencedCodeSlice, displayEnd: number): CodeRange {
	const bounds = fenceBodyBounds(slice);
	// A fence with no body line yet (` ``` ` plus its ending) has a body start past
	// the display text, so the block's own end is the floor everything collapses to.
	const start = Math.min(bounds.start, displayEnd);
	return { start, end: Math.min(Math.max(bounds.end, start), displayEnd) };
}

/**
 * The body's display-text bounds, excluding both fence lines. `end` reads the body's
 * own trailing ending through `displayLength`, so a CRLF document's boundary does not
 * land between the `\r` and the `\n`.
 */
function fenceBodyBounds(slice: ReturnType<typeof sliceFencedCode>): CodeRange {
	const start = slice.openerLine.length;
	return { start, end: start + displayLength(slice.body) };
}
