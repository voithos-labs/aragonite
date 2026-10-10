/**
 * Pure decisions that keep a caret and an edit off a fenced code block's fence lines where the
 * mode hides them; there, editable content is the body plus the opener's info string. Where the
 * mode paints them, edits land and the fence write rule keeps one opener and one closer. Every
 * route that writes a range asks `editSpan`. Display-text coordinates throughout.
 */

import type { NodeView } from '../../../core/node-views';
import { metadataOf } from '../../../core/nodes';
import { displayLength } from '../../../core/lines';
import { fenceAnatomy } from '../../../core/parsers/fence-syntax';
import { sliceFencedCode, type FencedCodeSlice } from './code-renderer';
import type { RawRange } from '../../../caret/widget-offset';

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

/** Backspace at the body start would delete the opener's `\n`, and Delete at the body end the
 *  body's; either reshapes the block, so both move focus out instead. */
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

/** A `\n` inside either fence line breaks the fence, so an Enter there moves to the nearest body
 *  edge; each fence line's inner edge is already safe and stays put. */
export function clampEnterOffsetToBody(node: NodeView, offset: number): number {
	const { openerTextEnd, body, closerTextStart } = fenceRegions(node);
	if (offset < openerTextEnd) return body.start;
	if (offset > closerTextStart) return body.end;
	return offset;
}

/** For gestures that rewrite whole lines (indent, dedent): a tab on the closer pushes it past
 *  GFM's three-space limit, and one on the opener demotes the block. */
export function clampRangeToBody(node: NodeView, range: RawRange): RawRange {
	const { start: lo, end: hi } = bodyWindow(node);
	const clamp = (offset: number) => Math.min(Math.max(offset, lo), hi);
	return { start: clamp(range.start), end: clamp(range.end) };
}

/** Whether an edit reaches past the body and the opener's info string. An unclosed fence's run
 *  counts as content, so deleting it is how a just-typed ` ``` ` is undone. */
export function crossesFenceBoundary(node: NodeView, range: RawRange): boolean {
	const { openerContent, body } = fenceRegions(node);
	const lo = Math.min(range.start, range.end);
	const hi = Math.max(range.start, range.end);
	if (lo >= openerContent.start && hi <= openerContent.end) return false;
	return !(lo >= body.start && hi <= body.end);
}

/** The span a ranged edit rewrites: the range where the fence lines show. Where they're hidden, its
 *  body part once it reaches them, or null with no body left, never a body edge nobody pointed at. */
export function editSpan(
	node: NodeView,
	range: RawRange,
	fenceLinesShown: boolean
): RawRange | null {
	const span = orderedRange(range);
	if (fenceLinesShown || !crossesFenceBoundary(node, span)) return span;
	const body = clampRangeToBody(node, span);
	return body.start === body.end ? null : body;
}

/** Whether `editSpan` kept `range` whole, so the range never reached a hidden fence line. */
export function spanKeepsRange(range: RawRange, span: RawRange | null): boolean {
	const ordered = orderedRange(range);
	return span !== null && span.start === ordered.start && span.end === ordered.end;
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

function orderedRange(range: RawRange): RawRange {
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

/** `end` reads the body's trailing ending through `displayLength`, so a CRLF boundary never
 *  lands between the `\r` and the `\n`. */
function fenceBodyBounds(slice: FencedCodeSlice): RawRange {
	const start = slice.openerLine.length;
	return { start, end: start + displayLength(slice.body) };
}
