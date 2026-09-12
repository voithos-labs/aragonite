/**
 * Toggle an inline format inside a prose block. Over a SELECTION the direction is parse coverage,
 * not edge adjacency: a covered range unapplies (aligned strip, else split, over every covering run
 * in turn), overlapping or abutting runs apply over their union, a bare range wraps the core its
 * boundary whitespace leaves. Where the mode PAINTS delimiters the strip and the wrap write
 * unverified; every other candidate declines unless it verifies. At a COLLAPSED CARET: unwrap the
 * span, else drop the empty pair, else insert one (live-mode.md § 4.3). Every write clamps to the
 * CONTENT range: a marker in `# ` changes the kind.
 */

import { recordFormatCoverageRead } from '../../perf/instruments';
import { paintsFocusedMarkers, type PresentationMode } from '../../presentation-mode';
import {
	getInlineMarkPolicy,
	listInlineMarks,
	type InlineMarkKind,
	type InlineMarkPolicy
} from '../../schema/inline-construct-policy';
import type { InlineNode } from '../nodes';
import { constructContentRange, inlineDescendants, parseInline, type ContentRange } from './index';
import { CONTENT_VISIBILITY, renderedText } from './visibility';

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

	// Painted delimiters are the mode's own answer, so those modes write their candidate unverified.
	// The preview rungs paint: this seam only writes into the block those rungs reveal.
	const paints = paintsFocusedMarkers(mode ?? 'source');
	const { from, to, covering } = coveredReading(display, inlines, start, end, format);

	// A strip sheds ONE run, so where a second of the same kind covers the selection too, the answer
	// is the covering arm's split: stripping there leaves the press's own read still active.
	const sole = covering.length > 1 ? null : soleStripCandidate(display, inlines, from, to, format);
	if (sole) return paints || preservesScreen(sole, edit, screenOf(display, content)) ? sole : null;

	// The flank strip rewrites bytes OUTSIDE the selection, and byte equality can mistake a nested
	// run's delimiters for the enclosing one's, so its candidate verifies like the split's.
	const enclosing = enclosingSpanOf(inlines, from, to, format);
	if (enclosing && flanksAreItsMarkers(display, from, to, enclosing)) {
		const flank = firstFlipVerified(
			[flankStrip(display, from, to, enclosing)],
			edit,
			format,
			'unapply'
		);
		if (flank) return flank;
	}

	if (covering.length > 0)
		return firstFlipVerified(
			covering.flatMap((span) => splitCandidates(display, inlines, span, from, to, format)),
			edit,
			format,
			'unapply'
		);

	const union = formatUnionOf(inlines, start, end, format);
	if (union)
		return firstFlipVerified(
			absorbCandidates(display, inlines, union, { start, end }, format, mark),
			edit,
			format,
			'apply'
		);

	// A wrap whose markers do not paint owes split and absorb's coverage check: bytes that re-pair
	// against a neighbouring run leave the range unformatted with nothing on screen to say so.
	const wrap = wrapCandidate(display, inlines, start, end, mark);
	if (!wrap) return null;
	return paints ? wrap : firstFlipVerified([wrap], edit, format, 'apply');
}

/** Whether a toggle right now would UNAPPLY — the pressed-state a toolbar paints. The same arms
 *  the toggle routes by, asked without emitting: a caret inside the construct, a selection
 *  carrying its own markers, flanked by them, or covered by a same-format construct. */
export function isInlineFormatActive(edit: InlineFormatEdit, format: InlineMarkKind): boolean {
	return coverageCarries(coverageOf(edit), format);
}

/** The pressed state a result would paint: the same read, over the bytes and range it hands back.
 *  One home for the after-read, so the seam's own direction check and the ladder guard cannot
 *  drift on the content-end arithmetic. */
export function isInlineFormatActiveAfter(
	edit: InlineFormatEdit,
	result: ToggleInlineFormatResult,
	format: InlineMarkKind
): boolean {
	return isInlineFormatActive(
		{
			display: result.newDisplay,
			content: shiftedContent(edit.content, edit.display, result),
			selection: { start: result.newSelStart, end: result.newSelEnd }
		},
		format
	);
}

/** Every registered mark the edit's range already carries. */
export function activeInlineFormats(edit: InlineFormatEdit): Set<InlineMarkKind> {
	return inlineFormatsCovering(
		edit,
		listInlineMarks().map((entry) => entry.kind)
	);
}

/** Which of `candidates` the range carries, off ONE parse of the block. A toolbar asks once per
 *  button on every selection change and every answer is the same walk; taking candidates rather
 *  than the vocabulary is what lets a range's running intersection stop re-asking ruled-out marks. */
export function inlineFormatsCovering(
	edit: InlineFormatEdit,
	candidates: Iterable<InlineMarkKind>
): Set<InlineMarkKind> {
	const coverage = coverageOf(edit);
	const carried = new Set<InlineMarkKind>();
	for (const kind of candidates) if (coverageCarries(coverage, kind)) carried.add(kind);
	return carried;
}

/** The same read, one id at a time, with consecutive asks over one block state sharing the parse:
 *  a toolbar's buttons arrive as N separate calls, and only the caller knows they are one repaint.
 *  One slot, since the previous state is dead the moment a keystroke or the caret moves. */
export function createInlineFormatActiveMemo(): (
	edit: InlineFormatEdit,
	format: InlineMarkKind
) => boolean {
	let slot: { edit: InlineFormatEdit; coverage: Coverage } | null = null;
	return (edit, format) => {
		if (!slot || !sameEdit(slot.edit, edit)) slot = { edit, coverage: coverageOf(edit) };
		return coverageCarries(slot.coverage, format);
	};
}

// ── Coverage ─────────────────────────────────────────────────────────────────

/** The block and the selected slice, each parsed once, so asking mark after mark costs the walks
 *  rather than the parses. */
interface Coverage {
	display: string;
	start: number;
	end: number;
	inlines: readonly InlineNode[];
	/** The slice parsed standalone; empty at a caret, where the aligned arm never asks. */
	sliceNodes: readonly InlineNode[];
}

function coverageOf(edit: InlineFormatEdit): Coverage {
	recordFormatCoverageRead();
	const { display, content, selection } = edit;
	const start = clampToContent(selection.start, content);
	const end = clampToContent(selection.end, content);
	const inlines = parseInline(display, content.start, content.end);
	// A selection spanning the whole display is the same parse, byte bounds included — which is
	// every middle block of a cross-block range, so the second parse is worth not making.
	const sliceIsDisplay = start === 0 && end === display.length;
	return {
		display,
		start,
		end,
		inlines,
		sliceNodes:
			start === end
				? []
				: sliceIsDisplay
					? inlines
					: parseInline(display.slice(start, end), 0, end - start)
	};
}

/** The memo's key: field-wise, where the cross-block sibling composes a string, because the
 *  display here is the block's whole raw and building a key would cost what the memo saves. */
function sameEdit(a: InlineFormatEdit, b: InlineFormatEdit): boolean {
	return (
		a.display === b.display &&
		a.content.start === b.content.start &&
		a.content.end === b.content.end &&
		a.selection.start === b.selection.start &&
		a.selection.end === b.selection.end
	);
}

/** The one home for "does this range carry this mark", so every reader asks the same guards —
 *  including the mark-row test, which a kind with no vocabulary has to fail rather than parse. */
function coverageCarries(
	{ display, start, end, inlines, sliceNodes }: Coverage,
	format: InlineMarkKind
): boolean {
	if (!getInlineMarkPolicy(format)) return false;
	if (start === end) return enclosingSpanOf(inlines, start, start, format) !== null;
	if (soleSpanOfSelection(sliceNodes, inlines, start, end, format)) return true;
	const enclosing = enclosingSpanOf(inlines, start, end, format);
	if (enclosing && flanksAreItsMarkers(display, start, end, enclosing)) return true;
	return coveredReading(display, inlines, start, end, format).covering.length > 0;
}

/**
 * The range an unapply reads, with the runs covering it. A run closes against a word and never
 * whitespace, so the wrap leaves a boundary space OUTSIDE the delimiters: a selection reaching
 * past a run by whitespace alone is still that run's own, or it could not take its own mark off.
 */
function coveredReading(
	display: string,
	inlines: readonly InlineNode[],
	start: number,
	end: number,
	format: InlineMarkKind
): { from: number; to: number; covering: FormatSpan[] } {
	const covering = coveringSpansOf(inlines, start, end, format);
	if (covering.length > 0) return { from: start, to: end, covering };
	const trimmed = withoutBoundaryWhitespace(display, start, end);
	if (!trimmed || (trimmed.start === start && trimmed.end === end))
		return { from: start, to: end, covering };
	const inner = coveringSpansOf(inlines, trimmed.start, trimmed.end, format);
	return inner.length > 0
		? { from: trimmed.start, to: trimmed.end, covering: inner }
		: { from: start, to: end, covering };
}

// ── Aligned unapply ──────────────────────────────────────────────────────────

/** The selection carries its own flanking markers (the user selected `**word**`): exactly one
 *  span covering the whole slice, so the strip can't orphan markers on `**a** **b**`. It rewrites
 *  only selected bytes, so it keeps the press's literal reading, and it sheds the runs of its own
 *  kind inside that reading, or a whole-range unapply would leave part of the range formatted. */
function soleStripCandidate(
	display: string,
	inlines: readonly InlineNode[],
	start: number,
	end: number,
	format: InlineMarkKind
): ToggleInlineFormatResult | null {
	const slice = display.slice(start, end);
	const sliceNodes = parseInline(slice, 0, slice.length);
	const selfSpan = soleSpanOfSelection(sliceNodes, inlines, start, end, format);
	if (!selfSpan) return null;
	const unwrapped = stripKindMarkers(
		display,
		inlines,
		format,
		start + selfSpan.contentStart,
		start + selfSpan.contentEnd
	);
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
	// A selection wholly inside the run's delimiters clamps to nothing; emitting there writes the
	// bytes unchanged and collapses the selection onto a caret.
	if (cutEnd <= cutStart) return [];
	if (!cutsLandCleanly(inlines, { start: cutStart, end: cutEnd }, span)) return [];
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

/** The run grows to the union, the SELECTION does not: each endpoint is carried through the
 *  strip and re-wrap, so a press over half a run leaves that half selected. An endpoint on the
 *  union's edge keeps the new marker inside the range, as a bare wrap's selection does. */
function absorbCandidates(
	display: string,
	inlines: readonly InlineNode[],
	union: { start: number; end: number },
	selected: { start: number; end: number },
	format: InlineMarkKind,
	mark: InlineMarkPolicy
): ToggleInlineFormatResult[] {
	if (!cutsLandCleanly(inlines, union, union)) return [];
	const cuts = kindMarkerCuts(inlines, format, union.start, union.end);
	const stripped = spliceOutCuts(display, cuts, union.start, union.end);
	const prefix = display.slice(0, union.start);
	const suffix = display.slice(union.end);
	const wrapAt = (lead: string, core: string, trail: string): ToggleInlineFormatResult => {
		const wrapped = wrapSlice(core, mark);
		// The kind may pad its fence, so the marker widths are read off the wrap, not the row.
		const found = core ? wrapped.indexOf(core) : -1;
		const open = found >= 0 ? found : (wrapped.length - core.length) / 2;
		const close = wrapped.length - core.length - open;
		const coreStart = lead.length;
		const coreEnd = lead.length + core.length;
		const startAt = strippedOffset(cuts, union.start, selected.start);
		const endAt = strippedOffset(cuts, union.start, selected.end);
		const shift = (at: number, edgeInclusive: 'start' | 'end') => {
			if (edgeInclusive === 'start' ? at <= coreStart : at < coreStart) return at;
			if (edgeInclusive === 'start' ? at <= coreEnd : at < coreEnd) return at + open;
			return at + open + close;
		};
		return {
			newDisplay: prefix + lead + wrapped + trail + suffix,
			newSelStart: prefix.length + shift(startAt, 'start'),
			newSelEnd: prefix.length + shift(endAt, 'end')
		};
	};
	const out = [wrapAt('', stripped, '')];
	const lead = leadingWs(stripped);
	const trail = trailingWs(stripped);
	if ((lead || trail) && lead.length + trail.length < stripped.length)
		out.push(wrapAt(lead, stripped.slice(lead.length, stripped.length - trail.length), trail));
	return out;
}

/** Whether a rewrite of `within` may splice at both `cuts`: each has to land where a byte splice
 *  can, in a text run or on a construct boundary, never strictly inside another construct's bytes —
 *  a stranded delimiter re-pairs with whatever run the parse finds next, which can preserve the
 *  text while reformatting content nobody selected. Split, absorb and the wrap all ask here. */
function cutsLandCleanly(
	inlines: readonly InlineNode[],
	cuts: { start: number; end: number },
	within: { start: number; end: number }
): boolean {
	for (const node of inlineDescendants(inlines)) {
		if (node.kind === 'text') continue;
		if (node.start <= within.start && within.end <= node.end) continue;
		if (node.start < cuts.start && cuts.start < node.end) return false;
		if (node.start < cuts.end && cuts.end < node.end) return false;
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
	return spliceOutCuts(display, kindMarkerCuts(inlines, format, from, to), from, to);
}

/** The marker byte ranges of every `format` run lying wholly inside [from, to), in order. */
function kindMarkerCuts(
	inlines: readonly InlineNode[],
	format: InlineMarkKind,
	from: number,
	to: number
): [number, number][] {
	const cuts: [number, number][] = [];
	for (const node of inlineDescendants(inlines)) {
		if (node.kind !== format) continue;
		const span = spanOf(node);
		if (!span || span.start < from || span.end > to) continue;
		cuts.push([span.start, span.contentStart], [span.contentEnd, span.end]);
	}
	return cuts.sort((a, b) => a[0] - b[0]);
}

function spliceOutCuts(display: string, cuts: [number, number][], from: number, to: number) {
	let out = '';
	let at = from;
	for (const [cutFrom, cutTo] of cuts) {
		out += display.slice(at, cutFrom);
		at = cutTo;
	}
	return out + display.slice(at, to);
}

/** Where a display offset lands in the stripped slice: the cut bytes before it fall away, and an
 *  offset inside a marker rides to that marker's start. */
function strippedOffset(cuts: [number, number][], from: number, offset: number): number {
	let removed = 0;
	for (const [cutFrom, cutTo] of cuts)
		if (cutFrom < offset) removed += Math.min(cutTo, offset) - cutFrom;
	return Math.max(0, offset - from - removed);
}

// ── Wrap ─────────────────────────────────────────────────────────────────────

/**
 * The bare wrap, over the selection's trimmed core: markdown opens and closes a run against a word,
 * never whitespace, so a boundary space goes to the plain text beside the run, as
 * `live-split-rebalance` reads the same problem. Null where nothing survives the trim, or where an
 * endpoint is no legal cut: markers spliced into a construct's bytes re-pair.
 */
function wrapCandidate(
	display: string,
	inlines: readonly InlineNode[],
	start: number,
	end: number,
	mark: InlineMarkPolicy
): ToggleInlineFormatResult | null {
	const core = withoutBoundaryWhitespace(display, start, end);
	if (!core || !cutsLandCleanly(inlines, core, core)) return null;
	return wrapRange(display, core.start, core.end, mark);
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

function preservesScreen(
	candidate: ToggleInlineFormatResult,
	edit: InlineFormatEdit,
	shown: string
): boolean {
	const { display, content } = edit;
	return screenOf(candidate.newDisplay, shiftedContent(content, display, candidate)) === shown;
}

/** Both checks a candidate owes wherever its own bytes are not the mode's answer: the content text
 *  unchanged, and the selection's coverage actually flipped — text preservation alone admits a
 *  nested pair that leaves the range formatted exactly as it was. */
function firstFlipVerified(
	candidates: ToggleInlineFormatResult[],
	edit: InlineFormatEdit,
	format: InlineMarkKind,
	direction: 'apply' | 'unapply'
): ToggleInlineFormatResult | null {
	const { display, content } = edit;
	const shown = screenOf(display, content);
	return (
		candidates.find(
			(candidate) =>
				preservesScreen(candidate, edit, shown) &&
				coverageFlipped(candidate, shiftedContent(content, display, candidate), format, direction)
		) ?? null
	);
}

/** Whether NO same-format run is left overlapping the selection, or one covers it whole — the
 *  press's direction, asked of the bytes it would write. */
function coverageFlipped(
	candidate: ToggleInlineFormatResult,
	content: ContentRange,
	format: InlineMarkKind,
	direction: 'apply' | 'unapply'
): boolean {
	const { newDisplay, newSelStart: from, newSelEnd: to } = candidate;
	const inlines = parseInline(newDisplay, content.start, content.end);
	if (direction === 'apply') return coveringSpansOf(inlines, from, to, format).length > 0;
	const spans: { start: number; end: number }[] = [];
	for (const node of inlineDescendants(inlines))
		if (node.kind === format) spans.push({ start: node.start, end: node.end });
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

/** Every construct of this kind whose WHOLE RANGE covers the selection, peeled of the delimiters
 *  the selection takes whole — coverage that reaches into the delimiters still reads as "already
 *  formatted", and where runs of one kind nest, shedding the inner one leaves the outer covering,
 *  so the split tries each in turn. */
function coveringSpansOf(
	inlines: readonly InlineNode[],
	start: number,
	end: number,
	format: InlineMarkKind
): FormatSpan[] {
	const range = peeledToContent(inlines, start, end);
	const covering: FormatSpan[] = [];
	for (const node of inlineDescendants(inlines)) {
		if (node.kind !== format) continue;
		const span = spanOf(node);
		if (span && span.start <= range.start && range.end <= span.end) covering.push(span);
	}
	return covering;
}

/** The range with the delimiters of every construct it takes WHOLE peeled off: a run nests inside
 *  another kind's bytes (`***ab***` is emphasis around strong), so a range that takes the outer
 *  construct whole is asking about the content that construct encloses. */
function peeledToContent(
	inlines: readonly InlineNode[],
	start: number,
	end: number
): { start: number; end: number } {
	let from = start;
	let to = end;
	for (;;) {
		const span = spanExactlyOver(inlines, from, to);
		if (!span) return { start: from, end: to };
		from = span.contentStart;
		to = span.contentEnd;
	}
}

function spanExactlyOver(
	inlines: readonly InlineNode[],
	start: number,
	end: number
): FormatSpan | null {
	// A toolbar asks the coverage read once per button on every selection change, so the walk skips
	// the children of every node too small to hold the range.
	const containing = (node: InlineNode) => node.start <= start && end <= node.end;
	for (const node of inlineDescendants(inlines, containing)) {
		if (node.start !== start || node.end !== end) continue;
		const span = spanOf(node);
		if (span) return span;
	}
	return null;
}

/**
 * The selection read as exactly one span of this kind — standalone AND in the block's own parse,
 * which is the only reading a strip may act on: `*bold*` carved out of `**bold**` is emphasis alone
 * while the block holds none, and shedding one delimiter layer there lands on a run of the same
 * kind. Offsets come back in SLICE space, where the strip splices.
 */
function soleSpanOfSelection(
	sliceNodes: readonly InlineNode[],
	inlines: readonly InlineNode[],
	start: number,
	end: number,
	format: InlineMarkKind
): FormatSpan | null {
	const span = soleSpanIn(sliceNodes, end - start, format);
	if (!span) return null;
	for (const node of inlineDescendants(inlines))
		if (node.kind === format && node.start === start && node.end === end) return span;
	return null;
}

function soleSpanIn(
	nodes: readonly InlineNode[],
	length: number,
	format: InlineMarkKind
): FormatSpan | null {
	if (nodes.length !== 1 || nodes[0].kind !== format) return null;
	const span = spanOf(nodes[0]);
	return span && span.start === 0 && span.end === length ? span : null;
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

/** A range minus its boundary whitespace, null once nothing is left. One home for the trim, so the
 *  wrap here and the cross-block decomposition that trims before it ever asks
 *  (`selection/cross-block/format-range.ts`) cannot disagree about where a run may close. */
export function withoutBoundaryWhitespace(
	display: string,
	from: number,
	to: number
): { start: number; end: number } | null {
	let start = from;
	let end = to;
	while (start < end && /\s/.test(display[start])) start++;
	while (end > start && /\s/.test(display[end - 1])) end--;
	return start === end ? null : { start, end };
}

// ── Content clamp ────────────────────────────────────────────────────────────

function clampToContent(offset: number, content: ContentRange): number {
	return Math.min(Math.max(offset, content.start), content.end);
}
