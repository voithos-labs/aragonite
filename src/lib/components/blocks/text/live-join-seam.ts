/**
 * The live-mode join rewrite (live-mode.md § 4.5): a destructive join cuts bytes the reader cannot see, so a
 * literal concatenation surfaces two things — the delimiter runs a truncation left unpaired, and
 * the closer/opener pair a split's inverse brings back to back around nothing. Both are dropped,
 * at the seam and nowhere else. Bytes stay candidates until the parser agrees: the joined block
 * must re-parse to ONE prose block showing exactly what the two sides showed, or the caller keeps
 * its literal join.
 */

import {
	constructContentRange,
	getContentRange,
	isProseKind,
	parseInline
} from '../../../core/inline';
import { renderedText } from '../../../core/inline-render';
import { trimTrailingLineEnding } from '../../../core/lines';
import type { LinkReferenceResolver } from '../../../core/inline/link-reference-resolver';
import type { AnyInlineKind, InlineNode } from '../../../core/nodes';
import { parse } from '../../../core/parser';
import {
	getInlineConstructPolicy,
	type JoinEndpoint,
	type LiveJoinSeamCleaner
} from '../../../schema/inline-construct-policy';

// ── The rewrite ──────────────────────────────────────────────────────────────

export const cleanLiveJoinSeam: LiveJoinSeamCleaner = (join) => {
	const resolver = join.linkRef?.current;
	const left = readSide(join.start, 'before', resolver);
	const right = readSide(join.end, 'after', resolver);
	if (left === null || right === null) return null;
	// Nothing stands on the seam, so the literal join is already the answer — and the ordinary
	// Backspace between two plain paragraphs pays no parse for it.
	if (!standsOnSeam(left) && !standsOnSeam(right)) return null;
	if (!anchorsOnMerged(join, left, right)) return null;

	const shown = shownAfterJoin(left, right);
	const pairs = abuttingPairSpans(join, left, right);
	// Keeping the runs the two sides can still pair across the seam is the least destructive
	// reading, so it leads; dropping every stranded run answers where markdown cannot rejoin them.
	// The two readings coincide whenever nothing paired across the seam, which is the common case;
	// rendering the identical bytes twice buys nothing.
	const readings = [unpairedSpans(join, left, right), everyDanglingSpan(join, left, right)];
	const candidates = readings.map((dangling) => [...dangling, ...pairs]);
	for (const spans of sameSpans(candidates[0], candidates[1]) ? [candidates[0]] : candidates) {
		const candidate = withoutSpans(join.mergedRaw, spans);
		if (visibleBlockText(candidate, resolver) !== shown) continue;
		// A candidate that changed nothing IS the literal join: declining says so, and keeps the
		// caller off a rewrite path it does not need.
		if (candidate === join.mergedRaw) return null;
		// The split half's terminal-trivia rule, on the join: a survivor that is only hard-break
		// whitespace reloads as blank trivia — a different shape than the block written — and a
		// terminal run paints nothing, so the declared drop is read here, not trusted: only
		// whitespace may go, and the emptied block's caret has one seat.
		const display = trimTrailingLineEnding(candidate);
		if (display !== '' && display.trim() === '') {
			return { raw: candidate.slice(display.length), seam: 0 };
		}
		// Every byte dropped ahead of the seam moves the caret's landing with it.
		const droppedBefore = spans
			.filter((span) => span.end <= join.seam)
			.reduce((total, span) => total + span.end - span.start, 0);
		return { raw: candidate, seam: join.seam - droppedBefore };
	}
	return null;
};

const standsOnSeam = (side: Side): boolean => side.dangling.length > 0 || side.touching.length > 0;

const sameSpans = (a: readonly Span[], b: readonly Span[]): boolean =>
	a.length === b.length && a.every((span, i) => span.start === b[i].start && span.end === b[i].end);

// ── The two sides ────────────────────────────────────────────────────────────

interface Span {
	start: number;
	end: number;
}

/** A construct the cut interacts with, in its own block's raw coordinates. */
interface SideConstruct {
	kind: AnyInlineKind;
	node: Span;
	content: Span;
}

interface Side {
	raw: string;
	content: Span;
	cut: number;
	inlines: readonly InlineNode[];
	/** Constructs the cut left open — opener kept without its closer, or the reverse. Outermost
	 *  first, so the two sides' sequences compare position by position. */
	dangling: SideConstruct[];
	/** Constructs whose delimiter run touches the cut from inside the surviving bytes: the
	 *  trailing closers of the block above, the leading openers of the block below. */
	touching: SideConstruct[];
}

/**
 * Read one endpoint's surviving bytes and the constructs its cut leaves at the seam. Null where
 * the cleanup has no business running: a non-prose kind, an offset outside the block's content,
 * or a cut through a construct whose family declares no close-and-reopen (an image, an escape,
 * an autolink) — those bytes mean nothing apart, so no run of theirs is the join's to drop.
 */
function readSide(
	endpoint: JoinEndpoint,
	keep: 'before' | 'after',
	resolver: LinkReferenceResolver | undefined
): Side | null {
	const { node, offset } = endpoint;
	if (!isProseKind(node.kind)) return null;
	const content = getContentRange(node);
	if (offset < content.start || offset > content.end) return null;

	const inlines = parseInline(node.raw, content.start, content.end, resolver);
	const { ranged, atomic } = classifyConstructs(inlines);
	// A run whose bytes mean nothing apart — an image, an escape, an autolink — has no halves to
	// keep, and a cut through the middle of a delimiter run leaves half of one behind. Neither is
	// a thing any reading of the seam can repair. Live's caret cannot land there; a plugin's can.
	if (atomic.some((span) => offset > span.start && offset < span.end)) return null;
	if (ranged.some((c) => splitsARun(c, offset))) return null;
	// Dangling is about the PARTNER: this side keeps one run of the pair and the cut took the
	// other. Content-range containment is not the test — a cut at a construct's content start
	// leaves its opener behind just as surely as one in the middle does.
	const dangling = ranged.filter((c) =>
		keep === 'before'
			? c.content.start <= offset && offset < c.node.end
			: c.node.start < offset && offset <= c.content.end
	);
	if (dangling.some((c) => !isRejoinable(c.kind))) return null;

	return {
		raw: node.raw,
		content,
		cut: offset,
		inlines,
		dangling,
		touching: touchingChain(ranged, offset, keep)
	};
}

/** Constructs with a content range (outermost first) apart from those without one, whose bytes
 *  the seam can only step around. */
function classifyConstructs(inlines: readonly InlineNode[]): {
	ranged: SideConstruct[];
	atomic: Span[];
} {
	const ranged: SideConstruct[] = [];
	const atomic: Span[] = [];
	const visit = (nodes: readonly InlineNode[]): void => {
		for (const node of nodes) {
			if (node.kind === 'text') continue;
			const content = constructContentRange(node);
			if (!content) {
				atomic.push({ start: node.start, end: node.end });
				continue;
			}
			ranged.push({ kind: node.kind, node: { start: node.start, end: node.end }, content });
			if (node.children) visit(node.children);
		}
	};
	visit(inlines);
	return { ranged, atomic };
}

const splitsARun = (c: SideConstruct, at: number): boolean =>
	(at > c.node.start && at < c.content.start) || (at > c.content.end && at < c.node.end);

/** Whether the family declares its delimiters cuttable and rejoinable at all (live-mode.md § 4.4). */
function isRejoinable(kind: AnyInlineKind): boolean {
	return getInlineConstructPolicy(kind)?.splitBehavior === 'close-and-reopen';
}

/**
 * The nested chain of closers ending at `cut` (or openers starting there), peeled outermost
 * first: `**a *b***` cut at its end gives the strong, then the emphasis its closer wraps. This is
 * the shape `live-split-rebalance` writes, read back.
 */
function touchingChain(
	constructs: readonly SideConstruct[],
	cut: number,
	keep: 'before' | 'after'
): SideConstruct[] {
	const chain: SideConstruct[] = [];
	let at = cut;
	for (;;) {
		const link = constructs.find((c) =>
			keep === 'before' ? c.node.end === at : c.node.start === at
		);
		if (!link || !isRejoinable(link.kind)) return chain;
		chain.push(link);
		at = keep === 'before' ? link.content.end : link.content.start;
	}
}

/** Whether the merged bytes are still the two sides' bytes end to end — a normalizer that
 *  rewrote either one moves every offset below, so the cleanup stands down instead. */
function anchorsOnMerged(
	join: { mergedRaw: string; seam: number },
	left: Side,
	right: Side
): boolean {
	return (
		join.mergedRaw.slice(0, join.seam) === left.raw.slice(0, left.cut) &&
		join.mergedRaw.startsWith(right.raw.slice(right.cut, right.content.end), join.seam)
	);
}

// ── The spans a join may drop ────────────────────────────────────────────────

/** A left-side span is already in merged coordinates; a right-side one shifts by the seam. */
const rightSpan = (join: { seam: number }, right: Side, span: Span): Span => ({
	start: join.seam + span.start - right.cut,
	end: join.seam + span.end - right.cut
});

const openerRun = (c: SideConstruct): Span => ({ start: c.node.start, end: c.content.start });
const closerRun = (c: SideConstruct): Span => ({ start: c.content.end, end: c.node.end });

/** Whether two constructs are written with the same delimiters — the byte-level test for "these
 *  are one construct's two halves", which kind equality alone cannot make (`__a__` vs `**a**`). */
const sameDelimiters = (left: Side, lc: SideConstruct, right: Side, rc: SideConstruct): boolean =>
	left.raw.slice(lc.node.start, lc.content.start) ===
		right.raw.slice(rc.node.start, rc.content.start) &&
	left.raw.slice(lc.content.end, lc.node.end) === right.raw.slice(rc.content.end, rc.node.end);

/**
 * The runs a truncation stranded that the join does NOT put back together: the left's opener
 * chain and the right's closer chain, minus the leading pairs whose kinds line up — those two
 * halves make one construct across the seam, which is what the reader had.
 */
function unpairedSpans(join: { seam: number }, left: Side, right: Side): Span[] {
	let paired = 0;
	while (
		paired < left.dangling.length &&
		paired < right.dangling.length &&
		left.dangling[paired].kind === right.dangling[paired].kind
	) {
		paired++;
	}
	return [
		...left.dangling.slice(paired).map(openerRun),
		...right.dangling.slice(paired).map((c) => rightSpan(join, right, closerRun(c)))
	];
}

/** The fallback reading: every stranded run goes, so the joined text stands as plain content. */
function everyDanglingSpan(join: { seam: number }, left: Side, right: Side): Span[] {
	return [
		...left.dangling.map(openerRun),
		...right.dangling.map((c) => rightSpan(join, right, closerRun(c)))
	];
}

/**
 * The closer/opener pair a split's inverse brings back to back: same kinds nested the same way,
 * written with the same bytes, enclosing nothing between them. Whole chain or nothing — dropping
 * an outer pair while an inner one stays would leave both halves' runs unbalanced.
 */
function abuttingPairSpans(join: { seam: number }, left: Side, right: Side): Span[] {
	const closing = left.touching;
	const opening = right.touching;
	if (closing.length === 0 || closing.length !== opening.length) return [];
	for (let i = 0; i < closing.length; i++) {
		if (closing[i].kind !== opening[i].kind) return [];
		if (!sameDelimiters(left, closing[i], right, opening[i])) return [];
	}
	return [
		{ start: closing[closing.length - 1].content.end, end: left.cut },
		rightSpan(join, right, {
			start: right.cut,
			end: opening[opening.length - 1].content.start
		})
	];
}

function withoutSpans(raw: string, spans: readonly Span[]): string {
	let out = '';
	let at = 0;
	for (const span of [...spans].sort((a, b) => a.start - b.start)) {
		if (span.start < at) continue;
		out += raw.slice(at, span.start);
		at = span.end;
	}
	return out + raw.slice(at);
}

// ── Verification ─────────────────────────────────────────────────────────────

/**
 * What the reader is owed: what each side ALREADY SHOWED of the bytes that survive. Read off the
 * pre-join parse, never off the joined halves — a half read alone prints the runs whose partner
 * the cut took, and a cleaned half can lose a construct the drop made intraword, so either would
 * bake the very defect this checks for into its own expectation.
 */
const shownAfterJoin = (left: Side, right: Side): string =>
	visibleSide(left, 'before') + visibleSide(right, 'after');

/**
 * What a reader sees, asked of the thing that paints it: the render path's own DOM with every
 * marker span dropped. The clip decides only WHERE the bytes stop; a construct the cut crosses
 * contributes its content, since its delimiter runs paint nothing either way.
 */
function visibleSide(side: Side, keep: 'before' | 'after'): string {
	return renderedText(clipNodes(side.inlines, side.cut, keep), side.raw);
}

function clipNodes(
	level: readonly InlineNode[],
	cut: number,
	keep: 'before' | 'after'
): InlineNode[] {
	const before = keep === 'before';
	const out: InlineNode[] = [];
	for (const node of level) {
		if (before ? node.end <= cut : node.start >= cut) {
			out.push(node);
			continue;
		}
		if (before ? node.start >= cut : node.end <= cut) continue;
		if (node.kind === 'text') {
			out.push({ ...node, ...(before ? { end: cut } : { start: cut }) });
			continue;
		}
		const content = constructContentRange(node);
		if (!content) continue;
		if (node.children && node.children.length > 0) {
			out.push(...clipNodes(node.children, cut, keep));
			continue;
		}
		// A code span carries its content as bytes rather than children, so the surviving part of
		// it is that byte range read as text — which is exactly what the span paints.
		const start = before ? content.start : Math.max(content.start, cut);
		const end = before ? Math.min(content.end, cut) : content.end;
		if (end > start) out.push({ kind: 'text', start, end });
	}
	return out;
}

/** The candidate read back as a block: a join produces ONE, and a candidate that parses to two
 *  (or to a kind with no inline content) is not the thing the caller is about to install. */
function visibleBlockText(raw: string, resolver: LinkReferenceResolver | undefined): string | null {
	const blocks = parse(raw, { scope: 'fragment' }).children;
	if (blocks.length !== 1 || !isProseKind(blocks[0].kind)) return null;
	const block = blocks[0];
	const range = getContentRange(block);
	return renderedText(parseInline(block.raw, range.start, range.end, resolver), block.raw);
}
