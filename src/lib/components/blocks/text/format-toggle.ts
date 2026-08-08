/**
 * Toggle an inline format inside a prose block. Over a SELECTION, strips flanking markers only
 * when they belong to a same-format construct enclosing it, else wraps — so emphasis over `word`
 * in `**word**` nests to `***word***` rather than eating a star. At a COLLAPSED CARET, unwraps the
 * enclosing span, else removes the empty pair the previous press left, else inserts a pair and
 * lands the caret between its halves — a strategy live mode forks away from first, since a pair it
 * paints nothing for is invisible garbage (pending marks, § 4.3). Every write clamps to the CONTENT
 * range: a marker spliced into a heading's `# ` or a setext underline changes the block's kind.
 */

import { parseInline, type ContentRange } from '../../../core/inline';
import type { InlineNode } from '../../../core/nodes';
import type { InlineMarkKind } from '../../../cursor/pending-marks';
import { constructContentRange } from './edge-seat';

// ── Public API ───────────────────────────────────────────────────────────────

const MARKERS: Record<InlineMarkKind, string> = {
	strong: '**',
	emphasis: '*',
	strikethrough: '~~',
	inlineCode: '`'
};

/** The bare delimiter run that opens and closes a construct of this kind. Inline code's run grows
 *  with what it encloses, so a wrap over content sizes its own fence (`codeWrap`). */
export function markersFor(format: InlineMarkKind): string {
	return MARKERS[format];
}

export interface ToggleInlineFormatResult {
	newDisplay: string;
	newSelStart: number;
	newSelEnd: number;
}

export function toggleInlineFormat(
	display: string,
	content: ContentRange,
	selection: { start: number; end: number },
	format: InlineMarkKind
): ToggleInlineFormatResult {
	const start = clampToContent(selection.start, content);
	const end = clampToContent(selection.end, content);
	// The same bounds the block itself parses with, so no construct can straddle the structural
	// bytes the clamp above keeps the write out of.
	const inlines = parseInline(display, content.start, content.end);
	if (start === end) return toggleAtCaret(display, inlines, start, format);

	const slice = display.slice(start, end);

	// The selection carries its own flanking markers (the user selected `**word**`). Exactly one
	// span covering the whole slice, so the strip can't orphan markers on `**a** **b**`.
	const selfSpan = soleSpanOf(slice, format);
	if (selfSpan) {
		const unwrapped = slice.slice(selfSpan.contentStart, selfSpan.contentEnd);
		return {
			newDisplay: display.slice(0, start) + unwrapped + display.slice(end),
			newSelStart: start,
			newSelEnd: start + unwrapped.length
		};
	}

	// Markers outside the selection (`word` inside `*word*`). The construct check is what makes
	// `**word**` toggled to emphasis nest rather than strip.
	const enclosing = enclosingSpanOf(inlines, start, end, format);
	if (enclosing && flanksAreItsMarkers(display, start, end, enclosing)) {
		const mLen = markerLengthOf(enclosing);
		return {
			newDisplay: display.slice(0, start - mLen) + slice + display.slice(end + mLen),
			newSelStart: start - mLen,
			newSelEnd: end - mLen
		};
	}

	const wrapped = wrapSlice(slice, format);
	return {
		newDisplay: display.slice(0, start) + wrapped + display.slice(end),
		newSelStart: start,
		newSelEnd: start + wrapped.length
	};
}

// ── Caret ────────────────────────────────────────────────────────────────────

function toggleAtCaret(
	display: string,
	inlines: readonly InlineNode[],
	caret: number,
	format: InlineMarkKind
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

	const markers = markersFor(format);
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
 * The innermost construct of this kind whose CONTENT covers `[start, end]`. Innermost, so
 * `***x***` toggled to strong drops the strong layer and leaves emphasis standing; and needs the
 * FULL-context parse, since `*word*` carved from `**word**` and from `***word***` read
 * identically in isolation but only the latter sits inside an emphasis span.
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

function wrapSlice(slice: string, format: InlineMarkKind): string {
	if (format === 'inlineCode') return codeWrap(slice);
	const markers = markersFor(format);
	return markers + slice + markers;
}

/**
 * A code fence is one backtick longer than the longest run it encloses, so no inner run can close
 * it. Content touching a backtick at either edge takes a space pad as well: without it the fence
 * and the content merge into one longer run, and the span closes somewhere else entirely.
 */
function codeWrap(slice: string): string {
	const fence = '`'.repeat(longestBacktickRun(slice) + 1);
	const pad = slice.startsWith('`') || slice.endsWith('`') ? ' ' : '';
	return fence + pad + slice + pad + fence;
}

function longestBacktickRun(text: string): number {
	let longest = 0;
	let run = 0;
	for (const char of text) {
		run = char === '`' ? run + 1 : 0;
		if (run > longest) longest = run;
	}
	return longest;
}

function clampToContent(offset: number, content: ContentRange): number {
	return Math.min(Math.max(offset, content.start), content.end);
}
