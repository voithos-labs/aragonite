/**
 * Pure decisions that keep a caret and an edit off a fenced code block's fence lines where the
 * mode hides them; there, editable content is the body plus the opener's info string. Where the
 * mode paints them, edits land and the fence write rule keeps one opener and one closer.
 * Display-text coordinates throughout.
 */

import type { NodeView } from '../../../core/node-views';
import { metadataOf } from '../../../core/nodes';
import { displayLength, trimTrailingLineEnding } from '../../../core/lines';
import { fenceAnatomy } from '../../../core/parsers/fence-syntax';
import { sliceFencedCode, type FencedCodeSlice } from './code-renderer';
import type { RawRange } from '../editable-surface';

// ── Public API ──────────────────────────────────────────────────────────────

export interface FenceBoundaryInput {
	node: NodeView;
	offset: number;
	/** True when the user pressed Delete (forward) rather than Backspace. */
	forward: boolean;
}

export type FenceBoundaryResult =
	| { kind: 'allow' } // native edit is safe
	| { kind: 'exitPrev' } // crossing the opener boundary backward
	| { kind: 'exitNext' }; // crossing the closer boundary forward

/**
 * Classify a Backspace/Delete against the two body boundaries: Backspace at bodyStart
 * would delete the opener's terminating `\n`, and Delete at bodyEnd the body's; either
 * reparses the block in a different shape, so both become a move of the focus instead.
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
 * Clamp an Enter out of both fence lines onto the nearest body edge: a `\n` inside
 * the opener reshapes the fence, one inside the closer breaks it apart. Each
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
 * Clamp a whole range onto the body, unconditionally, for gestures that rewrite entire lines
 * (Tab indent, Shift+Tab dedent), where a tab on the closer pushes it past GFM's three-space
 * limit and one on the opener demotes the block. Other range gestures use `fenceEditSpan`.
 */
export function clampRangeToBody(node: NodeView, range: RawRange): RawRange {
	const { start: lo, end: hi } = bodyWindow(node);
	const clamp = (offset: number) => Math.min(Math.max(offset, lo), hi);
	return { start: clamp(range.start), end: clamp(range.end) };
}

/**
 * Does a pending edit reach out of the editable content, which is the body plus the opener's info
 * string? Every other offset on the fence lines is one keystroke from swallowing the blocks below
 * into the code node. An unclosed fence is the exception: with no closer to strand, its run is
 * content too, so demoting the block is how a just-typed ` ``` ` is undone.
 */
export function crossesFenceBoundary(node: NodeView, range: RawRange): boolean {
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
export function fenceEditSpan(node: NodeView, range: RawRange): RawRange {
	const span = orderedRange(range);
	return crossesFenceBoundary(node, span) ? clampRangeToBody(node, span) : span;
}

/**
 * Where a caret arriving from outside the block lands, in every mode: on the body. On a hidden
 * fence line it would take keystrokes the fence check refuses, so the next character disappears.
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
export function isStructureOnlyRange(node: NodeView, range: RawRange): boolean {
	const ordered = orderedRange(range);
	if (!crossesFenceBoundary(node, ordered)) return false;
	const span = clampRangeToBody(node, ordered);
	return span.start === span.end;
}

/**
 * The one splice over a range in place where the fence lines are hidden: the browser's delete
 * and type-over, through the beforeinput check, and cut. Null when there is nothing to rewrite.
 */
export function computeFenceRangedEdit(
	node: NodeView,
	range: RawRange,
	insert: string
): FenceRangedEdit | null {
	if (isStructureOnlyRange(node, range)) return null;
	return computeRangedEdit(trimTrailingLineEnding(node.raw), fenceEditSpan(node, range), insert);
}

/** `insert` spliced over `range` of `display`; null when it changes nothing, so no undo entry is used. */
export function computeRangedEdit(
	display: string,
	range: RawRange,
	insert: string
): FenceRangedEdit | null {
	const span = orderedRange(range);
	const newText = display.slice(0, span.start) + insert + display.slice(span.end);
	if (newText === display) return null;
	return { newText, newCursor: span.start + insert.length };
}

export interface FenceRangedEdit {
	newText: string;
	newCursor: number;
}

/** The body's own span, the only lines a vertical arrival may land a caret on. */
export function bodyWindow(node: NodeView): RawRange {
	return bodyWindowOf(sliceFencedCode(node), displayLength(node.raw));
}

// ── Internal ────────────────────────────────────────────────────────────────

interface FenceRegions {
	/** End of the opener's own text, before the line ending that starts the body. */
	openerTextEnd: number;
	/**
	 * The editable span of the opener line: the info string of a closed fence, or the
	 * whole opener text while the fence is still unclosed (see `crossesFenceBoundary`).
	 */
	openerContent: RawRange;
	body: RawRange;
	/** Start of the closer's own text, past the body's line ending. */
	closerTextStart: number;
}

function fenceRegions(node: NodeView): FenceRegions {
	const slice = sliceFencedCode(node);
	const displayEnd = displayLength(node.raw);
	const body = bodyWindowOf(slice, displayEnd);
	const openerTextEnd = Math.min(displayLength(slice.openerLine), displayEnd);
	// The run is measured, so an opener a paste grew to four markers measures as four; a line past
	// the three-space indent limit opens no fence and has no info string at all.
	const marker = metadataOf(node, 'fencedCode').fenceMarker;
	const opener = fenceAnatomy(slice.openerLine, { marker, length: 3 });
	const hasCloser = slice.closerLine.length > 0;
	let contentStart = 0;
	if (!opener) contentStart = openerTextEnd;
	else if (hasCloser) contentStart = Math.min(opener.runEnd, openerTextEnd);
	return {
		openerTextEnd,
		openerContent: { start: contentStart, end: openerTextEnd },
		body,
		// `slice.body` carries its own trailing ending, so its full length is where the
		// closer line begins; an unclosed fence has no closer and collapses onto the end.
		closerTextStart: Math.min(body.start + slice.body.length, displayEnd)
	};
}

export function orderedRange(range: RawRange): RawRange {
	return {
		start: Math.min(range.start, range.end),
		end: Math.max(range.start, range.end)
	};
}

function bodyWindowOf(slice: FencedCodeSlice, displayEnd: number): RawRange {
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
function fenceBodyBounds(slice: FencedCodeSlice): RawRange {
	const start = slice.openerLine.length;
	return { start, end: start + displayLength(slice.body) };
}
