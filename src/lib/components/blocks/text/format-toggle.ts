/**
 * Toggle an inline format inside a prose block. Over a SELECTION the direction is parse coverage,
 * not edge adjacency: a range a same-format construct covers unapplies (aligned strip, else split);
 * one overlapping or abutting same-format runs applies over their union (absorb); a bare range
 * wraps, literal-first where the mode paints delimiters. Split and absorb verify in every mode
 * and decline over rewriting what they cannot verify. At a COLLAPSED CARET: unwrap the span,
 * else drop the empty pair, else insert one (live mode forks first, live-mode.md § 4.3). Every
 * write clamps to the CONTENT range: a marker in `# ` or a setext underline changes the kind.
 */

import {
	constructContentRange,
	inlineDescendants,
	parseInline,
	type ContentRange
} from '../../../core/inline';
import { CONTENT_VISIBILITY, renderedText } from '../../../core/inline/visibility';
import type { InlineNode } from '../../../core/nodes';
import type { InlineMarkKind } from '../../../cursor/pending-marks';
import { paintsFocusedMarkers, type PresentationMode } from '../../../presentation-mode';
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

/** Null for a kind whose row declares no mark, or for a press whose every candidate fails its
 *  verification: the vocabulary lives on the row, so a kind without one has no delimiters this
 *  seam could write, and a toggle's sound fallback is not writing. */
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

	const sole = soleStripCandidate(display, start, end, format);
	if (sole) return modeGated([sole], display, content, mode);

	// The flank strip rewrites bytes OUTSIDE the selection, and byte equality can mistake literal
	// content for the delimiters, so its candidate verifies like the split's and falls through.
	const enclosing = enclosingSpanOf(inlines, start, end, format);
	if (enclosing && flanksAreItsMarkers(display, start, end, enclosing)) {
		const flank = firstFlipVerified(
			[flankStrip(display, start, end, enclosing)],
			edit,
			format,
			'unapply'
		);
		if (flank) return flank;
	}

	const covering = coveringSpanOf(inlines, start, end, format);
	if (covering)
		return firstFlipVerified(
			splitCandidates(display, inlines, covering, start, end, format),
			edit,
			format,
			'unapply'
		);

	const union = formatUnionOf(inlines, start, end, format);
	if (union)
		return firstFlipVerified(
			absorbCandidates(display, inlines, union, format, mark),
			edit,
			format,
			'apply'
		);

	return modeGated(wrapCandidates(display, start, end, mark), display, content, mode);
}

/** Whether a toggle right now would UNAPPLY — the pressed-state a toolbar paints. The same arms
 *  the toggle routes by, asked without emitting: a caret inside the construct, a selection
 *  carrying its own markers, flanked by them, or covered by a same-format construct. */
export function isInlineFormatActive(edit: InlineFormatEdit, format: InlineMarkKind): boolean {
	if (!getInlineMarkPolicy(format)) return false;
	const { display, content, selection } = edit;
	const start = clampToContent(selection.start, content);
	const end = clampToContent(selection.end, content);
	const inlines = parseInline(display, content.start, content.end);
	if (start === end) return enclosingSpanOf(inlines, start, start, format) !== null;
	if (soleSpanOf(display.slice(start, end), format)) return true;
	const enclosing = enclosingSpanOf(inlines, start, end, format);
	if (enclosing && flanksAreItsMarkers(display, start, end, enclosing)) return true;
	return coveringSpanOf(inlines, start, end, format) !== null;
}

// ── Aligned unapply ──────────────────────────────────────────────────────────

/** The selection carries its own flanking markers (the user selected `**word**`): exactly one
 *  span covering the whole slice, so the strip can't orphan markers on `**a** **b**`. It rewrites
 *  only selected bytes, so it keeps the press's literal reading. */
function soleStripCandidate(
	display: string,
	start: number,
	end: number,
	format: InlineMarkKind
): ToggleInlineFormatResult | null {
	const slice = display.slice(start, end);
	const selfSpan = soleSpanOf(slice, format);
	if (!selfSpan) return null;
	const unwrapped = slice.slice(selfSpan.contentStart, selfSpan.contentEnd);
	return {
		newDisplay: display.slice(0, start) + unwrapped + display.slice(end),
		newSelStart: start,
		newSelEnd: start + unwrapped.length
	};
}

/** Markers outside the selection (`word` inside `*word*`), stripped at the selection's flanks
 *  rather than the construct's own run, so a `***word***` stack sheds one layer by run
 *  arithmetic; the construct check is what makes `**word**` toggled to emphasis nest instead. */
function flankStrip(
	display: string,
	start: number,
	end: number,
	span: FormatSpan
): ToggleInlineFormatResult {
	const mLen = markerLengthOf(span);
	return {
		newDisplay:
			display.slice(0, start - mLen) + display.slice(start, end) + display.slice(end + mLen),
		newSelStart: start - mLen,
		newSelEnd: end - mLen
	};
}

// ── Split unapply ────────────────────────────────────────────────────────────

/**
 * The construct re-emitted around the selection: each non-empty half keeps the construct's own
 * delimiter run, and a half's boundary whitespace yields a second candidate with it moved outside,
 * since the symmetric runs cannot close against a space. The middle sheds the markers of any
 * same-format construct it wholly contains, or it would reload still formatted.
 */
function splitCandidates(
	display: string,
	inlines: readonly InlineNode[],
	span: FormatSpan,
	start: number,
	end: number,
	format: InlineMarkKind
): ToggleInlineFormatResult[] {
	const cutStart = Math.max(start, span.contentStart);
	const cutEnd = Math.min(end, span.contentEnd);
	if (!cutLandsCleanly(inlines, cutStart, span) || !cutLandsCleanly(inlines, cutEnd, span))
		return [];
	const opener = display.slice(span.start, span.contentStart);
	const closer = display.slice(span.contentEnd, span.end);
	const middle = stripKindMarkers(display, inlines, format, cutStart, cutEnd);
	const prefix = display.slice(0, span.start);
	const out: ToggleInlineFormatResult[] = [];
	for (const left of halfVariants(display.slice(span.contentStart, cutStart), opener, closer))
		for (const right of halfVariants(display.slice(cutEnd, span.contentEnd), opener, closer))
			out.push({
				newDisplay: prefix + left + middle + right + display.slice(span.end),
				newSelStart: prefix.length + left.length,
				newSelEnd: prefix.length + left.length + middle.length
			});
	return out;
}

/** A kept-whitespace emission first, then one with the boundary whitespace moved outside the
 *  delimiters; a half that is empty or all whitespace carries no delimiters at all. */
function halfVariants(text: string, opener: string, closer: string): string[] {
	const lead = leadingWs(text);
	if (lead === text) return [text];
	const kept = opener + text + closer;
	const trail = trailingWs(text);
	if (!lead && !trail) return [kept];
	return [
		kept,
		lead + opener + text.slice(lead.length, text.length - trail.length) + closer + trail
	];
}

// ── Absorb apply ─────────────────────────────────────────────────────────────

/**
 * The selection grown over every same-format construct it touches, to a fixed point. Only
 * recursive-content constructs join: one holding literal text (a code span) means its delimiters
 * are honest content inside any wider span, so merging would rewrite what the reader sees.
 */
function formatUnionOf(
	inlines: readonly InlineNode[],
	start: number,
	end: number,
	format: InlineMarkKind
): { start: number; end: number } | null {
	const spans: FormatSpan[] = [];
	for (const node of inlineDescendants(inlines)) {
		if (node.kind !== format || !node.children) continue;
		const span = spanOf(node);
		if (span) spans.push(span);
	}
	let from = start;
	let to = end;
	let touched = false;
	let grew = true;
	while (grew) {
		grew = false;
		for (const span of spans) {
			if (span.end < from || span.start > to) continue;
			touched = true;
			if (span.start < from || span.end > to) {
				from = Math.min(from, span.start);
				to = Math.max(to, span.end);
				grew = true;
			}
		}
	}
	return touched ? { start: from, end: to } : null;
}

function absorbCandidates(
	display: string,
	inlines: readonly InlineNode[],
	union: { start: number; end: number },
	format: InlineMarkKind,
	mark: InlineMarkPolicy
): ToggleInlineFormatResult[] {
	if (!cutLandsCleanly(inlines, union.start, union) || !cutLandsCleanly(inlines, union.end, union))
		return [];
	const stripped = stripKindMarkers(display, inlines, format, union.start, union.end);
	const prefix = display.slice(0, union.start);
	const suffix = display.slice(union.end);
	const wrapAt = (lead: string, core: string, trail: string): ToggleInlineFormatResult => {
		const wrapped = wrapSlice(core, mark);
		return {
			newDisplay: prefix + lead + wrapped + trail + suffix,
			newSelStart: prefix.length + lead.length,
			newSelEnd: prefix.length + lead.length + wrapped.length
		};
	};
	const out = [wrapAt('', stripped, '')];
	const lead = leadingWs(stripped);
	const trail = trailingWs(stripped);
	if ((lead || trail) && lead.length + trail.length < stripped.length)
		out.push(wrapAt(lead, stripped.slice(lead.length, stripped.length - trail.length), trail));
	return out;
}

/** Whether `cut` lands where a byte splice can: in a text run or on a construct boundary, never
 *  strictly inside another construct's bytes — a stranded delimiter re-pairs with whatever run the
 *  parse finds next, which can preserve the text while reformatting content nobody selected. */
function cutLandsCleanly(
	inlines: readonly InlineNode[],
	cut: number,
	within: { start: number; end: number }
): boolean {
	for (const node of inlineDescendants(inlines)) {
		if (node.kind === 'text') continue;
		if (node.start <= within.start && within.end <= node.end) continue;
		if (node.start < cut && cut < node.end) return false;
	}
	return true;
}

/** The bytes of `[from, to)` with the delimiter runs of every same-format construct lying wholly
 *  inside removed; one straddling the range keeps its markers, for the verifier to judge. */
function stripKindMarkers(
	display: string,
	inlines: readonly InlineNode[],
	format: InlineMarkKind,
	from: number,
	to: number
): string {
	const cuts: [number, number][] = [];
	for (const node of inlineDescendants(inlines)) {
		if (node.kind !== format) continue;
		const span = spanOf(node);
		if (!span || span.start < from || span.end > to) continue;
		cuts.push([span.start, span.contentStart], [span.contentEnd, span.end]);
	}
	cuts.sort((a, b) => a[0] - b[0]);
	let out = '';
	let at = from;
	for (const [cutFrom, cutTo] of cuts) {
		out += display.slice(at, cutFrom);
		at = cutTo;
	}
	return out + display.slice(at, to);
}

// ── Wrap ─────────────────────────────────────────────────────────────────────

/**
 * What a bare wrap could mean, what it literally says first. Only the wrap has a second reading:
 * markdown opens and closes a run against a word, never whitespace, so a boundary space goes to
 * the plain text beside the run, as `live-split-rebalance` reads the same problem.
 */
function wrapCandidates(
	display: string,
	start: number,
	end: number,
	mark: InlineMarkPolicy
): ToggleInlineFormatResult[] {
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

/** Painted delimiters are the mode's own answer, so the bytes stand whatever they parse as; the
 *  marker-hiding modes accept only a candidate whose screen is unchanged. The preview rungs paint:
 *  this seam only writes into the caret's block, which is the block those rungs reveal. */
function modeGated(
	candidates: ToggleInlineFormatResult[],
	display: string,
	content: ContentRange,
	mode: PresentationMode | undefined
): ToggleInlineFormatResult | null {
	if (paintsFocusedMarkers(mode ?? 'source')) return candidates[0] ?? null;
	const shown = screenOf(display, content);
	return (
		candidates.find(
			(candidate) =>
				screenOf(candidate.newDisplay, shiftedContent(content, display, candidate)) === shown
		) ?? null
	);
}

/** Split and absorb rewrite bytes the user did not select, so they verify in EVERY mode: the
 *  content text unchanged, and the selection's coverage actually flipped — text preservation alone
 *  admits a nested pair that leaves the range formatted exactly as it was. */
function firstFlipVerified(
	candidates: ToggleInlineFormatResult[],
	edit: InlineFormatEdit,
	format: InlineMarkKind,
	direction: 'apply' | 'unapply'
): ToggleInlineFormatResult | null {
	const { display, content } = edit;
	const shown = screenOf(display, content);
	return (
		candidates.find((candidate) => {
			const shifted = shiftedContent(content, display, candidate);
			if (screenOf(candidate.newDisplay, shifted) !== shown) return false;
			return coverageFlipped(candidate, shifted, format, direction);
		}) ?? null
	);
}

function coverageFlipped(
	candidate: ToggleInlineFormatResult,
	content: ContentRange,
	format: InlineMarkKind,
	direction: 'apply' | 'unapply'
): boolean {
	const { newDisplay, newSelStart: from, newSelEnd: to } = candidate;
	if (from === to) return true;
	const spans: { start: number; end: number }[] = [];
	for (const node of inlineDescendants(parseInline(newDisplay, content.start, content.end)))
		if (node.kind === format) spans.push({ start: node.start, end: node.end });
	if (direction === 'apply') return spans.some((span) => span.start <= from && to <= span.end);
	return spans.every((span) => span.end <= from || to <= span.start);
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

	// The empty pair the previous press inserted; there is no span to find, since `****` parses as
	// literal text. Removal is the exact inverse of the insert below, so the pair must be a run of
	// its own: a marker character abutting either side means these are bytes the user wrote, and
	// this arm only runs where the mode paints them.
	if (isLoneEmptyPair(display, caret, markers)) {
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

/** Both halves at the caret, with no marker character abutting the pair on either side. */
function isLoneEmptyPair(display: string, caret: number, markers: string): boolean {
	const mLen = markers.length;
	const start = caret - mLen;
	if (start < 0) return false;
	return (
		display.slice(start, caret) === markers &&
		display.slice(caret, caret + mLen) === markers &&
		display[start - 1] !== markers[0] &&
		display[caret + mLen] !== markers[mLen - 1]
	);
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
	for (const node of inlineDescendants(inlines)) {
		if (node.kind !== format) continue;
		const span = spanOf(node);
		if (span && span.contentStart <= start && end <= span.contentEnd) found = span;
	}
	return found;
}

/** The innermost construct of this kind whose WHOLE RANGE covers the selection — coverage that
 *  reaches into the delimiters still reads as "already formatted", and the split clamps its cuts
 *  back into the content. */
function coveringSpanOf(
	inlines: readonly InlineNode[],
	start: number,
	end: number,
	format: InlineMarkKind
): FormatSpan | null {
	let found: FormatSpan | null = null;
	for (const node of inlineDescendants(inlines)) {
		if (node.kind !== format) continue;
		const span = spanOf(node);
		if (span && span.start <= start && end <= span.end) found = span;
	}
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

// ── Whitespace ───────────────────────────────────────────────────────────────

function leadingWs(text: string): string {
	return /^\s*/.exec(text)![0];
}

function trailingWs(text: string): string {
	return /\s*$/.exec(text)![0];
}

// ── Content clamp ────────────────────────────────────────────────────────────

function clampToContent(offset: number, content: ContentRange): number {
	return Math.min(Math.max(offset, content.start), content.end);
}
