/**
 * Toggles an inline mark inside a prose block, and answers whether a range already carries one.
 * The parse decides the direction; in a mode that hides markers a candidate must leave the screen
 * text unchanged (`docs/design/live-mode.md` § 2, and § 4.3 for a collapsed caret). Writes stay
 * inside the content range, since a marker written into `# ` would change the block's kind.
 */

import { recordFormatCoverageRead } from '../../perf/instruments';
import {
	getInlineMarkPolicy,
	listInlineMarks,
	type InlineMarkKind,
	type InlineMarkPolicy
} from '../../schema/inline-construct-policy';
import type { Reading } from '../../schema/reading';
import type { InlineNode } from '../nodes';
import { constructContentRange, inlineDescendants, readInline, type ContentRange } from './index';
import { CONTENT_VISIBILITY, renderedText, visibleRuns } from './visibility';

// ── Public API ───────────────────────────────────────────────────────────────

/** Named fields, because the two ranges and the display are all offsets into the same string:
 *  a swapped content-and-selection pair type-checks and splices markers into structural bytes. */
export interface InlineFormatEdit {
	/** The block's display bytes: its raw without the trailing line ending. */
	display: string;
	/** The bytes the block's own kind calls content; every write clamps into them. */
	content: ContentRange;
	selection: { start: number; end: number };
	/** How the block was drawn: without its link definitions a reference link reads as plain
	 *  brackets and a wrap cuts through it, and its mode decides whether a candidate is verified. */
	reading: Reading;
}

export interface ToggleInlineFormatResult {
	newDisplay: string;
	newSelStart: number;
	newSelEnd: number;
}

/** Null for a kind whose policy row declares no mark (there are no delimiters to write) and for
 *  a toggle whose every candidate fails verification: the safe fallback is to write nothing. */
export function toggleInlineFormat(
	edit: InlineFormatEdit,
	format: InlineMarkKind
): ToggleInlineFormatResult | null {
	if (!edit.reading.hidesDelimitersAtCaret()) return writeToggle(edit, format);
	// Ranges that differ only by hidden markers at their ends look the same, and the DOM reads one
	// back as another, so the toggle reads the widest and hands back the text that shows.
	const result = writeToggle({ ...edit, selection: widestShowingSame(edit) }, format);
	return result && trimmedToShownText(result, edit);
}

function writeToggle(
	edit: InlineFormatEdit,
	format: InlineMarkKind
): ToggleInlineFormatResult | null {
	const mark = getInlineMarkPolicy(format);
	if (!mark) return null;
	const { display, content, selection } = edit;
	const start = clampToContent(selection.start, content);
	const end = clampToContent(selection.end, content);
	// Parsed with the block's own content bounds, so no construct can straddle the structural
	// bytes the clamp above keeps the write out of.
	const inlines = readInline(
		display,
		content.start,
		content.end,
		edit.reading.resolver,
		edit.reading.grammar
	);
	if (start === end) return toggleAtCaret(display, inlines, start, format, mark);

	// A mode that shows the delimiters writes its candidate unverified: the user sees the markers.
	// The preview modes count as showing them, since a toggle only writes into the focused block.
	const paints = !edit.reading.hidesDelimitersAtCaret();
	const { from, to, covering } = coveredReading(display, inlines, start, end, format);

	// A strip removes one run, so when a second run of the same kind also covers the selection the
	// split path below handles it: stripping alone would leave the format still active.
	const sole =
		covering.length > 1
			? null
			: soleStripCandidate(display, inlines, from, to, format, edit.reading);
	if (sole)
		return paints || preservesScreen(sole, edit, screenOf(display, content, edit.reading))
			? sole
			: null;

	// The flank strip rewrites bytes outside the selection, and byte equality can mistake a nested
	// run's delimiters for the enclosing one's, so its candidate is verified like the split's.
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

	// A wrap with hidden markers is verified like split and absorb: markers that re-pair with a
	// neighbouring run leave the range unformatted, with nothing on screen to show it.
	const wrap = wrapCandidate(display, inlines, start, end, mark);
	if (!wrap) return null;
	return paints ? wrap : firstFlipVerified([wrap], edit, format, 'apply');
}

/** Whether a toggle right now would unformat, which is the pressed state a toolbar shows. The
 *  same checks the toggle routes by, asked without writing anything. */
export function isInlineFormatActive(edit: InlineFormatEdit, format: InlineMarkKind): boolean {
	return coverageCarries(coverageOf(edit), format);
}

/** The same read over the bytes and range `result` hands back, kept here so the toggle's direction
 *  check and the tests that re-read a result agree on where the content ends. */
export function isInlineFormatActiveAfter(
	edit: InlineFormatEdit,
	result: ToggleInlineFormatResult,
	format: InlineMarkKind
): boolean {
	return isInlineFormatActive(
		{
			display: result.newDisplay,
			content: shiftedContent(edit.content, edit.display, result),
			selection: { start: result.newSelStart, end: result.newSelEnd },
			reading: edit.reading
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

/** One parse of the block for every candidate. A toolbar asks per button on each selection
 *  change, so a caller can leave out marks it has already ruled out. */
export function inlineFormatsCovering(
	edit: InlineFormatEdit,
	candidates: Iterable<InlineMarkKind>
): Set<InlineMarkKind> {
	const coverage = coverageOf(edit);
	const carried = new Set<InlineMarkKind>();
	for (const kind of candidates) if (coverageCarries(coverage, kind)) carried.add(kind);
	return carried;
}

/** Shares one parse across a toolbar's per-button calls over the same block state. One memo
 *  entry only, since a keystroke or a caret move retires the previous state. */
export function createInlineFormatActiveMemo(): (
	edit: InlineFormatEdit,
	format: InlineMarkKind
) => boolean {
	// The resolver is kept apart from the edit because the editor's ref reads it through a getter,
	// so a definition edited elsewhere changes it under the same ref.
	let slot: {
		edit: InlineFormatEdit;
		resolver: Reading['resolver'];
		coverage: Coverage;
	} | null = null;
	return (edit, format) => {
		const resolver = edit.reading.resolver;
		if (!slot || slot.resolver !== resolver || !sameEdit(slot.edit, edit))
			slot = { edit, resolver, coverage: coverageOf(edit) };
		return coverageCarries(slot.coverage, format);
	};
}

// ── Ranges that show the same text ──────────────────────────────────────────

/** The selection grown over every mark whose content it is exactly: what the toggle reads in a
 *  mode where those marks' delimiters are hidden. */
function widestShowingSame(edit: InlineFormatEdit): { start: number; end: number } {
	const { display, content, reading } = edit;
	let start = clampToContent(edit.selection.start, content);
	let end = clampToContent(edit.selection.end, content);
	if (start === end) return { start, end };
	const inlines = readInline(
		display,
		content.start,
		content.end,
		reading.resolver,
		reading.grammar
	);
	for (let grew = true; grew;) {
		grew = false;
		for (const node of inlineDescendants(inlines)) {
			const inner = getInlineMarkPolicy(node.kind) ? constructContentRange(node) : null;
			if (!inner || inner.start !== start || inner.end !== end) continue;
			start = node.start;
			end = node.end;
			grew = true;
		}
	}
	return { start, end };
}

/** The handed-back range without the hidden bytes at either end. */
function trimmedToShownText(
	result: ToggleInlineFormatResult,
	edit: InlineFormatEdit
): ToggleInlineFormatResult {
	const { newDisplay, newSelStart, newSelEnd } = result;
	if (newSelStart === newSelEnd) return result;
	const { resolver, grammar } = edit.reading;
	const content = shiftedContent(edit.content, edit.display, result);
	const inlines = readInline(newDisplay, content.start, content.end, resolver, grammar);
	const shown = visibleRuns(inlines, newDisplay, CONTENT_VISIBILITY, { grammar }).filter(
		(run) => run.visible && run.start < newSelEnd && newSelStart < run.end
	);
	if (shown.length === 0) return result;
	return {
		newDisplay,
		newSelStart: Math.max(newSelStart, shown[0].start),
		newSelEnd: Math.min(newSelEnd, shown[shown.length - 1].end)
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
	/** The slice parsed standalone; empty at a caret, where the aligned strip never asks. */
	sliceNodes: readonly InlineNode[];
}

function coverageOf(edit: InlineFormatEdit): Coverage {
	recordFormatCoverageRead();
	const { display, content, selection } = edit;
	const start = clampToContent(selection.start, content);
	const end = clampToContent(selection.end, content);
	const inlines = readInline(
		display,
		content.start,
		content.end,
		edit.reading.resolver,
		edit.reading.grammar
	);
	// A selection spanning the whole display parses the same as the block, and that is every
	// middle block of a cross-block range, so the second parse is skipped.
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
					: readInline(
							display.slice(start, end),
							0,
							end - start,
							edit.reading.resolver,
							edit.reading.grammar
						)
	};
}

/** Field-wise comparison rather than a composed string key: the display is the block's whole raw,
 *  and building a key would cost what the memo saves. */
function sameEdit(a: InlineFormatEdit, b: InlineFormatEdit): boolean {
	return (
		a.display === b.display &&
		a.content.start === b.content.start &&
		a.content.end === b.content.end &&
		a.selection.start === b.selection.start &&
		a.selection.end === b.selection.end &&
		a.reading.grammar === b.reading.grammar
	);
}

/** The one place that answers "does this range carry this mark", so every reader applies the same
 *  checks, including the policy-row test a kind with no mark must fail without parsing. */
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

/** A run closes against a word, never whitespace, so a selection reaching past a run by
 *  whitespace alone still counts as that run, or it could not take its own mark off. */
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

/** For a selection holding its own markers (`**word**`), covered by exactly one span so that
 *  `**a** **b**` keeps its markers. Nested same-kind runs go too, or part stays formatted. */
function soleStripCandidate(
	display: string,
	inlines: readonly InlineNode[],
	start: number,
	end: number,
	format: InlineMarkKind,
	reading: Reading
): ToggleInlineFormatResult | null {
	const slice = display.slice(start, end);
	const sliceNodes = readInline(slice, 0, slice.length, reading.resolver, reading.grammar);
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

/** Markers just outside the selection (`word` in `*word*`) are cut at the selection's edges, not
 *  at the construct's own run, so `***word***` loses one layer. */
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

/** Each non-empty half keeps its delimiters, plus a candidate with boundary spaces moved out, as a
 *  run cannot close on a space. The middle loses nested same-format markers, or stays formatted. */
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

/** Grows to a fixed point over the same-format constructs the selection touches. Only ones with
 *  children join: inside a wider span a code span's delimiters would show as literal text. */
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

/** The run grows to the union but the selection does not: each endpoint is tracked through the
 *  strip and re-wrap, so a toggle over half a run leaves that half selected. */
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

/** Each cut must fall in a text run or on a construct boundary: a delimiter stranded inside a
 *  construct re-pairs with the next run the parse finds, formatting content nobody selected. */
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
 *  offset inside a marker moves to that marker's start. */
function strippedOffset(cuts: [number, number][], from: number, offset: number): number {
	let removed = 0;
	for (const [cutFrom, cutTo] of cuts)
		if (cutFrom < offset) removed += Math.min(cutTo, offset) - cutFrom;
	return Math.max(0, offset - from - removed);
}

// ── Wrap ─────────────────────────────────────────────────────────────────────

/** Boundary spaces stay outside the markers, since a run opens and closes against a word. Null
 *  when nothing survives the trim or an endpoint would cut into a construct. */
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
function screenOf(display: string, content: ContentRange, reading: Reading): string {
	return renderedText(
		readInline(display, content.start, content.end, reading.resolver, reading.grammar),
		display,
		CONTENT_VISIBILITY,
		{ grammar: reading.grammar }
	);
}

function preservesScreen(
	candidate: ToggleInlineFormatResult,
	edit: InlineFormatEdit,
	shown: string
): boolean {
	const { display, content } = edit;
	const shifted = shiftedContent(content, display, candidate);
	return screenOf(candidate.newDisplay, shifted, edit.reading) === shown;
}

/** The screen text must be unchanged and the coverage must actually flip: text preservation
 *  alone admits a nested pair that leaves the range formatted exactly as it was. */
function firstFlipVerified(
	candidates: ToggleInlineFormatResult[],
	edit: InlineFormatEdit,
	format: InlineMarkKind,
	direction: 'apply' | 'unapply'
): ToggleInlineFormatResult | null {
	const { display, content } = edit;
	const shown = screenOf(display, content, edit.reading);
	return (
		candidates.find(
			(candidate) =>
				preservesScreen(candidate, edit, shown) &&
				coverageFlipped(candidate, edit, format, direction)
		) ?? null
	);
}

/** Whether the toggle's direction holds in the bytes it would write: for apply, a same-format run
 *  covers the selection whole; for unapply, none still overlaps it. */
function coverageFlipped(
	candidate: ToggleInlineFormatResult,
	edit: InlineFormatEdit,
	format: InlineMarkKind,
	direction: 'apply' | 'unapply'
): boolean {
	const { newDisplay, newSelStart: from, newSelEnd: to } = candidate;
	const content = shiftedContent(edit.content, edit.display, candidate);
	const inlines = readInline(
		newDisplay,
		content.start,
		content.end,
		edit.reading.resolver,
		edit.reading.grammar
	);
	if (direction === 'apply') return coveringSpansOf(inlines, from, to, format).length > 0;
	const spans: { start: number; end: number }[] = [];
	for (const node of inlineDescendants(inlines))
		if (node.kind === format) spans.push({ start: node.start, end: node.end });
	return spans.every((span) => span.end <= from || to <= span.start);
}

/** The write stays inside the content range, so only its end moves, by what the candidate added. */
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

	// An empty pair from a previous toggle, which parses as literal text (`****`). A marker
	// character beside the pair means the user wrote these bytes, so only a lone pair goes.
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

/** Both delimiters of a construct are the same run, so the bytes outside its content split evenly;
 *  a code span's fence comes from `codeSpanFence`, through {@link constructContentRange}. */
function markerLengthOf(span: FormatSpan): number {
	return span.contentStart - span.start;
}

function spanOf(node: InlineNode): FormatSpan | null {
	const content = constructContentRange(node);
	if (!content || content.start <= node.start) return null;
	return { start: node.start, end: node.end, contentStart: content.start, contentEnd: content.end };
}

/** The innermost, from the block's full parse: `*word*` cut from `**word**` or from `***word***`
 *  reads the same alone, but only the latter sits inside an emphasis span. */
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

/** A selection reaching into the delimiters still reads as formatted. Every nested run of the
 *  kind is returned, since removing the inner one leaves the outer covering. */
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

/** A run can nest inside another kind's bytes (`***ab***` is emphasis around strong), so a range
 *  taking the outer construct whole is asking about the content inside it. */
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

/** Both parses must agree before a strip: `*bold*` cut from `**bold**` is emphasis alone but not
 *  in the block. Offsets are relative to the slice, where the strip splices. */
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

/** Shared with the cross-block path (`selection/cross-block/format-range.ts`) so the two agree
 *  on where a run may close. Null when nothing is left. */
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
