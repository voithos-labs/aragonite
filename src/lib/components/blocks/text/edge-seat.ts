/**
 * Which side of a construct's unpainted marker run a typed byte belongs to: a run painted at zero
 * width leaves one screen position naming two raw offsets. The kind's `edgeAffinity` policy answers
 * first (a link never extends), the arrival affinity second — and the painter has the last word
 * (live-mode.md § 2), since a seat that reads right can parse wrong.
 */

import type { AnyInlineKind, InlineNode } from '../../../core/nodes';
import type { EdgeAffinity } from '../../../cursor/edge-affinity';
import { constructContentRange, inlineDescendants, parseInline } from '../../../core/inline';
import {
	CONTENT_VISIBILITY,
	renderedText,
	visibleRuns,
	type VisibilityContext
} from '../../../core/inline/visibility';
import type { ContentRange } from '../../../core/inline';
import {
	getInlineConstructPolicy,
	type InlineConstructPolicy
} from '../../../schema/inline-construct-policy';
import { insertsExactly } from './screen-diff';

export interface EdgeSeat {
	/** Raw offset the byte must be written at. */
	offset: number;
	/** The construct whose hidden edge the caret sat at, which need not be the one holding
	 *  `offset`: a screen position reaches the runs abutting that construct's own. */
	kind: AnyInlineKind;
}

/**
 * Where `typed` belongs when the caret sits at `caretOffset`, or null when the offset touches no
 * construct marker run, the kind declares no policy, or no candidate earns the write. Declining is
 * the honest fallback: the byte then lands at the caret, which is what the engine writes anyway.
 */
export function resolveEdgeSeat(
	caretOffset: number,
	inlines: readonly InlineNode[],
	affinity: EdgeAffinity | null,
	raw: string,
	screen: VisibilityContext,
	typed: string
): EdgeSeat | null {
	const runs = markerRuns(inlines, raw, screen);
	const run = runAt(caretOffset, runs);
	if (!run) return null;
	const policy = getInlineConstructPolicy(run.kind);
	if (!policy) return null;
	const content = contentBounds(inlines);
	const before = shown(raw, content.start, content.end);
	const holds = (offset: number): boolean => {
		const candidate = raw.slice(0, offset) + typed + raw.slice(offset);
		const after = shown(candidate, content.start, content.end + typed.length);
		return insertsExactly(before, after, typed);
	};
	for (const offset of candidateOffsets(run, policy.edgeAffinity, affinity, caretOffset, runs)) {
		// The walk's read and Chromium's insertion canonicalize the same way, so a verified
		// `seat === caret` means native typing already lands where the seat wants it.
		if (offset === caretOffset) {
			if (holds(offset)) return null;
			continue;
		}
		if (holds(offset)) return { offset, kind: run.kind };
	}
	return null;
}

/**
 * The bytes a COMPOSITION commit should have written. `insertCompositionText` beforeinput is not
 * cancelable, so the seat cannot intercept the keystroke and relocates the composed run once, on
 * the commit that lands it. Null leaves the read as-is.
 */
export function relocateComposedRun(
	before: string,
	after: string,
	composedAt: number,
	inlines: readonly InlineNode[],
	affinity: EdgeAffinity | null,
	screen: VisibilityContext
): { raw: string; caret: number } | null {
	const composed = plainInsertionAt(before, after, composedAt);
	if (composed === null) return null;
	const seat = resolveEdgeSeat(composedAt, inlines, affinity, before, screen, composed);
	if (!seat) return null;
	return {
		raw: before.slice(0, seat.offset) + composed + before.slice(seat.offset),
		caret: seat.offset + composed.length
	};
}

/** The text a commit's read added at `at`, or null when the read is not a plain insertion
 *  there — a composition over a selection is a range op, and no seat claims a range. */
export function plainInsertionAt(before: string, after: string, at: number): string | null {
	const length = after.length - before.length;
	if (length <= 0 || at < 0 || at > before.length) return null;
	if (after.slice(0, at) !== before.slice(0, at)) return null;
	if (after.slice(at + length) !== before.slice(at)) return null;
	return after.slice(at, at + length);
}

/**
 * Every raw offset the caret's screen position ADMITS — the seat's whole reach, and empty where no
 * marker run touches the caret. A hidden run's hidden neighbours name the same position, so the
 * stretch of abutting runs is one position and each boundary in it is a seat; an offset inside a
 * run's own bytes is inside some construct's delimiters, which is where no byte belongs. A caret
 * strictly inside a run is one such offset, so the reach can exclude the caret it was asked about.
 */
export function seatOffsetsAt(
	caretOffset: number,
	inlines: readonly InlineNode[],
	raw: string,
	screen: VisibilityContext
): readonly number[] {
	const runs = markerRuns(inlines, raw, screen);
	const run = runAt(caretOffset, runs);
	if (!run) return [];
	const offsets = screenPositionOffsets(run, runs);
	return getInlineConstructPolicy(run.kind)?.edgeAffinity === 'never-extend'
		? offsets.filter((offset) => outsideSpan(run, offset))
		: offsets;
}

// ── Internal ─────────────────────────────────────────────────────────────────

interface MarkerRun {
	start: number;
	end: number;
	/** The opener's run; its near side is outside the construct, its far side inside. */
	leading: boolean;
	kind: AnyInlineKind;
	/** The construct's own bytes, which bound where a `never-extend` row admits a candidate. */
	span: ContentRange;
}

function offsetForSide(run: MarkerRun, side: EdgeAffinity): number {
	if (side === 'near') return run.start;
	if (side === 'far') return run.end;
	return run.leading ? run.start : run.end;
}

const otherEnd = (run: MarkerRun, side: EdgeAffinity): number =>
	offsetForSide(run, side) === run.start ? run.end : run.start;

/**
 * The offsets to try, best first: the policy's side, then the run's other end — the split
 * rebalancer's space-outside reading in the seat's terms, since a byte the run's inner side kills
 * is one its outer side keeps. Then the byte-literal write, verified like any other candidate: a
 * parse it rebinds is no reason to stop looking. The rest of the screen position ends the list,
 * nearest the policy's side first, for the caret whose own construct has no answer to give.
 */
function candidateOffsets(
	run: MarkerRun,
	edgeAffinity: InlineConstructPolicy['edgeAffinity'],
	affinity: EdgeAffinity | null,
	caretOffset: number,
	runs: readonly MarkerRun[]
): number[] {
	// Never-extend resolves like a line extreme: past the construct's delimiters, which is the
	// run's near side at an opener and its far side at a closer. A symmetric pair follows the
	// arrival, defaulting to the near side — the gdocs click default (live-mode.md § 4.2).
	const side: EdgeAffinity = edgeAffinity === 'never-extend' ? 'outside' : (affinity ?? 'near');
	const preferred = offsetForSide(run, side);
	const ranked = [preferred, otherEnd(run, side), caretOffset];
	const rest = screenPositionOffsets(run, runs)
		.filter((offset) => !ranked.includes(offset))
		.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred));
	const offsets = [...new Set([...ranked, ...rest])];
	return edgeAffinity === 'never-extend' ? offsets.filter((o) => outsideSpan(run, o)) : offsets;
}

/** Whether `offset` lies outside the run's own construct. A `never-extend` row admits nothing
 *  inside: half a URL is not a URL, half an escape is a literal backslash, and a destination the
 *  mode never paints is one the painter cannot check. Stated over the SPAN rather than over the
 *  run's inner end, since the screen position reaches an interior through a neighbour's run too. */
const outsideSpan = (run: MarkerRun, offset: number): boolean =>
	offset <= run.span.start || offset >= run.span.end;

/** The stretch of abutting runs `run` belongs to, as the boundary offsets inside it. */
function screenPositionOffsets(run: MarkerRun, runs: readonly MarkerRun[]): number[] {
	let lo = run.start;
	let hi = run.end;
	for (let grew = true; grew;) {
		grew = false;
		for (const other of runs) {
			if (other.start > hi || other.end < lo) continue;
			if (other.start < lo) {
				lo = other.start;
				grew = true;
			}
			if (other.end > hi) {
				hi = other.end;
				grew = true;
			}
		}
	}
	const bounds = new Set([lo, hi]);
	for (const other of runs) {
		if (other.start >= lo && other.start <= hi) bounds.add(other.start);
		if (other.end >= lo && other.end <= hi) bounds.add(other.end);
	}
	return [...bounds];
}

/** The bytes the inline tree covers — the block's content range, read off the tree rather than
 *  taken as a second parameter that could disagree with it. */
function contentBounds(inlines: readonly InlineNode[]): ContentRange {
	return { start: inlines[0].start, end: inlines[inlines.length - 1].end };
}

/** What a reader sees, asked of the thing that paints it (G4.33). The content reading, not the
 *  block's own: this seam only ADDS bytes, so no reading of it licenses dropping one. */
const shown = (raw: string, start: number, end: number): string =>
	renderedText(parseInline(raw, start, end), raw, CONTENT_VISIBILITY);

/** Every construct marker run, in pre-order. */
function markerRuns(
	inlines: readonly InlineNode[],
	raw: string,
	screen: VisibilityContext
): MarkerRun[] {
	const runs: MarkerRun[] = [];
	for (const node of inlineDescendants(inlines)) {
		const content = constructContentRange(node) ?? paintedRange(node, raw, screen);
		if (!content) continue;
		const span = { start: node.start, end: node.end };
		if (node.start < content.start) {
			runs.push({ start: node.start, end: content.start, leading: true, kind: node.kind, span });
		}
		if (content.end < node.end) {
			runs.push({ start: content.end, end: node.end, leading: false, kind: node.kind, span });
		}
	}
	return runs;
}

/**
 * The run `offset` sits in, its own boundaries included — the LAST in pre-order, so the innermost
 * construct at a shared boundary wins. INSIDE counts, not just the two ends: a doubled code fence
 * is a run a caret can be handed the middle of.
 */
const runAt = (offset: number, runs: readonly MarkerRun[]): MarkerRun | null =>
	runs.reduce<MarkerRun | null>(
		(found, run) => (offset >= run.start && offset <= run.end ? run : found),
		null
	);

/**
 * What a CHILDLESS construct paints, as a range in the block's own bytes: the outer bounds of its
 * visible runs, which such a construct has one contiguous stretch of — the precondition the two
 * marker runs below are carved out of, held by `test/core/inline/painted-contiguity.property`.
 * Asked of the render path rather than derived per kind, since which bytes a construct shows only
 * the painter answers (G4.33), and in the block's OWN reading: where its chrome paints, the whole
 * construct is on screen, no run is hidden, and the seat has nothing to relocate.
 */
function paintedRange(
	node: InlineNode,
	raw: string,
	screen: VisibilityContext
): ContentRange | null {
	if (node.kind === 'text') return null;
	const painted = visibleRuns([node], raw, screen).filter((run) => run.visible && run.text !== '');
	if (painted.length === 0) return null;
	return { start: painted[0].start, end: painted[painted.length - 1].end };
}
