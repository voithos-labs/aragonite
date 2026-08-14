/**
 * Toggle an inline format inside a prose block. Over a SELECTION, strips flanking markers only
 * when they belong to a same-format construct enclosing it, else wraps, and where the mode paints
 * no delimiter the bytes stay candidates until the render path agrees the screen is unchanged. At
 * a COLLAPSED CARET, unwraps the enclosing span, else removes the empty pair the previous press
 * left, else inserts a pair — a strategy live mode forks away from first (live-mode.md § 4.3).
 * Every write clamps to the CONTENT range: a marker in `# ` or a setext underline changes the kind.
 */

import { constructContentRange, parseInline, type ContentRange } from '../../../core/inline';
import { CONTENT_VISIBILITY, renderedText } from '../../../core/inline/visibility';
import type { InlineNode } from '../../../core/nodes';
import type { InlineMarkKind } from '../../../cursor/pending-marks';
import { hidesMarkers, type PresentationMode } from '../../../presentation-mode';
import {
	getInlineMarkPolicy,
	type InlineMarkPolicy
} from '../../../schema/inline-construct-policy';

// ── Public API ───────────────────────────────────────────────────────────────

/** Named fields, because the two ranges and the display are all offsets into the same string:
 *  a swapped content-and-selection pair type-checks and splices markers into structural bytes. */
export interface InlineFormatEdit {
	/** The block's display bytes — its raw without the trailing line ending. */
	display: string;
	/** The bytes the block's own kind calls content; every write clamps into them. */
	content: ContentRange;
	selection: { start: number; end: number };
}

export interface ToggleInlineFormatResult {
	newDisplay: string;
	newSelStart: number;
	newSelEnd: number;
}

/** Null for a kind whose row declares no mark, or for a selection whose every candidate would put
 *  a delimiter on a screen that paints none: the vocabulary lives on the row, so a kind without one
 *  has no delimiters this seam could write, and a toggle's sound fallback is not writing. */
export function toggleInlineFormat(
	edit: InlineFormatEdit,
	format: InlineMarkKind,
	mode: PresentationMode | undefined
): ToggleInlineFormatResult | null {
	const mark = getInlineMarkPolicy(format);
	if (!mark) return null;
	const { display, content, selection } = edit;
	const start = clampToContent(selection.start, content);
	const end = clampToContent(selection.end, content);
	// The same bounds the block itself parses with, so no construct can straddle the structural
	// bytes the clamp above keeps the write out of.
	const inlines = parseInline(display, content.start, content.end);
	if (start === end) return toggleAtCaret(display, inlines, start, format, mark);

	const candidates = selectionCandidates(display, inlines, start, end, format, mark);
	// Painted delimiters are the mode's own answer, so the bytes stand whatever they parse as.
	if (!hidesMarkers(mode ?? 'source')) return candidates[0] ?? null;
	const shown = screenOf(display, content);
	return (
		candidates.find(
			(candidate) =>
				screenOf(candidate.newDisplay, shiftedContent(content, display, candidate)) === shown
		) ?? null
	);
}

// ── Selection ────────────────────────────────────────────────────────────────

/**
 * What the press could mean over `[start, end)`, what it literally says first. Only the wrap has a
 * second reading: markdown opens and closes a run against a word, never whitespace, so a boundary
 * space goes to the plain text beside the run, as `live-split-rebalance` reads the same problem.
 */
function selectionCandidates(
	display: string,
	inlines: readonly InlineNode[],
	start: number,
	end: number,
	format: InlineMarkKind,
	mark: InlineMarkPolicy
): ToggleInlineFormatResult[] {
	const slice = display.slice(start, end);

	// The selection carries its own flanking markers (the user selected `**word**`). Exactly one
	// span covering the whole slice, so the strip can't orphan markers on `**a** **b**`.
	const selfSpan = soleSpanOf(slice, format);
	if (selfSpan) {
		const unwrapped = slice.slice(selfSpan.contentStart, selfSpan.contentEnd);
		return [
			{
				newDisplay: display.slice(0, start) + unwrapped + display.slice(end),
				newSelStart: start,
				newSelEnd: start + unwrapped.length
			}
		];
	}

	// Markers outside the selection (`word` inside `*word*`). The construct check is what makes
	// `**word**` toggled to emphasis nest rather than strip.
	const enclosing = enclosingSpanOf(inlines, start, end, format);
	if (enclosing && flanksAreItsMarkers(display, start, end, enclosing)) {
		const mLen = markerLengthOf(enclosing);
		return [
			{
				newDisplay: display.slice(0, start - mLen) + slice + display.slice(end + mLen),
				newSelStart: start - mLen,
				newSelEnd: end - mLen
			}
		];
	}

	const core = trimmedRange(display, start, end);
	const trimmed = core === null ? [] : [wrapRange(display, core.start, core.end, mark)];
	return [wrapRange(display, start, end, mark), ...trimmed];
}

/** The selection minus its boundary whitespace, or null when there is none to trim or nothing
 *  left once it goes. */
function trimmedRange(
	display: string,
	start: number,
	end: number
): { start: number; end: number } | null {
	let from = start;
	let to = end;
	while (from < to && /\s/.test(display[from])) from++;
	while (to > from && /\s/.test(display[to - 1])) to--;
	return (from === start && to === end) || from === to ? null : { start: from, end: to };
}

function wrapRange(
	display: string,
	start: number,
	end: number,
	mark: InlineMarkPolicy
): ToggleInlineFormatResult {
	const wrapped = wrapSlice(display.slice(start, end), mark);
	return {
		newDisplay: display.slice(0, start) + wrapped + display.slice(end),
		newSelStart: start,
		newSelEnd: start + wrapped.length
	};
}

// ── Verification ─────────────────────────────────────────────────────────────

/** A toggle changes formatting, never the text on screen, so the render path's own reading of the
 *  content is what a candidate has to leave unchanged (live-mode.md § 2). */
function screenOf(display: string, content: ContentRange): string {
	return renderedText(
		parseInline(display, content.start, content.end),
		display,
		CONTENT_VISIBILITY
	);
}

/** The write clamps into the content, so only its END moves, by what the candidate added. */
function shiftedContent(
	content: ContentRange,
	display: string,
	candidate: ToggleInlineFormatResult
): ContentRange {
	return { start: content.start, end: content.end + candidate.newDisplay.length - display.length };
}

// ── Caret ────────────────────────────────────────────────────────────────────

function toggleAtCaret(
	display: string,
	inlines: readonly InlineNode[],
	caret: number,
	format: InlineMarkKind,
	mark: InlineMarkPolicy
): ToggleInlineFormatResult {
	const enclosing = enclosingSpanOf(inlines, caret, caret, format);
	if (enclosing) {
		const mLen = markerLengthOf(enclosing);
		return {
			newDisplay:
				display.slice(0, enclosing.start) +
				display.slice(enclosing.contentStart, enclosing.contentEnd) +
				display.slice(enclosing.end),
			newSelStart: caret - mLen,
			newSelEnd: caret - mLen
		};
	}

	const markers = mark.markerBytes;
	const mLen = markers.length;

	// The empty pair the previous press inserted; there is no span to find, since `****` parses
	// as literal text.
	if (
		display.slice(caret - mLen, caret) === markers &&
		display.slice(caret, caret + mLen) === markers
	) {
		return {
			newDisplay: display.slice(0, caret - mLen) + display.slice(caret + mLen),
			newSelStart: caret - mLen,
			newSelEnd: caret - mLen
		};
	}

	return {
		newDisplay: display.slice(0, caret) + markers + markers + display.slice(caret),
		newSelStart: caret + mLen,
		newSelEnd: caret + mLen
	};
}

// ── Spans ────────────────────────────────────────────────────────────────────

interface FormatSpan {
	start: number;
	end: number;
	contentStart: number;
	contentEnd: number;
}

/** Both delimiters of a construct are the same run, so the bytes its content leaves over split
 *  evenly — which is how a code span's content-sized fence is read back off the parse. */
function markerLengthOf(span: FormatSpan): number {
	return span.contentStart - span.start;
}

function spanOf(node: InlineNode): FormatSpan | null {
	const content = constructContentRange(node);
	if (!content || content.start <= node.start) return null;
	return { start: node.start, end: node.end, contentStart: content.start, contentEnd: content.end };
}

/**
 * The innermost construct of this kind whose CONTENT covers `[start, end]`, off the FULL-context
 * parse: `*word*` carved from `**word**` and from `***word***` read identically in isolation, but
 * only the latter sits inside an emphasis span.
 */
function enclosingSpanOf(
	inlines: readonly InlineNode[],
	start: number,
	end: number,
	format: InlineMarkKind
): FormatSpan | null {
	let found: FormatSpan | null = null;
	const visit = (nodes: readonly InlineNode[]): void => {
		for (const node of nodes) {
			if (node.kind === format) {
				const span = spanOf(node);
				if (span && span.contentStart <= start && end <= span.contentEnd) found = span;
			}
			if (node.children) visit(node.children);
		}
	};
	visit(inlines);
	return found;
}

/** Exactly one span of this kind covering the whole slice, parsed standalone. */
function soleSpanOf(slice: string, format: InlineMarkKind): FormatSpan | null {
	const nodes = parseInline(slice, 0, slice.length);
	if (nodes.length !== 1 || nodes[0].kind !== format) return null;
	const span = spanOf(nodes[0]);
	return span && span.start === 0 && span.end === slice.length ? span : null;
}

/** Whether the bytes flanking the selection are the enclosing construct's own delimiters, rather
 *  than content that happens to sit there. */
function flanksAreItsMarkers(
	display: string,
	start: number,
	end: number,
	span: FormatSpan
): boolean {
	const mLen = markerLengthOf(span);
	return (
		display.slice(start - mLen, start) === display.slice(span.start, span.contentStart) &&
		display.slice(end, end + mLen) === display.slice(span.contentEnd, span.end)
	);
}

// ── Wrapping ─────────────────────────────────────────────────────────────────

function wrapSlice(slice: string, mark: InlineMarkPolicy): string {
	return mark.wrapBytes ? mark.wrapBytes(slice) : mark.markerBytes + slice + mark.markerBytes;
}

// ── Content clamp ────────────────────────────────────────────────────────────

function clampToContent(offset: number, content: ContentRange): number {
	return Math.min(Math.max(offset, content.start), content.end);
}
