/**
 * The live-mode join rewrite (§ 4.5): a destructive join cuts bytes the reader cannot see, so a
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
import type { AnyInlineKind, InlineNode } from '../../../core/nodes';
import { parse } from '../../../core/parser';
import {
	getInlineConstructPolicy,
	type JoinEndpoint,
	type LiveJoinSeamCleaner
} from '../../../schema/inline-construct-policy';

// ── The rewrite ──────────────────────────────────────────────────────────────

export const cleanLiveJoinSeam: LiveJoinSeamCleaner = (join) => {
	const left = readSide(join.start, 'before');
	const right = readSide(join.end, 'after');
	if (left === null || right === null) return null;
	// Nothing stands on the seam, so the literal join is already the answer — and the ordinary
	// Backspace between two plain paragraphs pays no parse for it.
	if (!standsOnSeam(left) && !standsOnSeam(right)) return null;
	if (!anchorsOnMerged(join, left, right)) return null;

	const shown = shownAfterJoin(left, right);
	const pairs = abuttingPairSpans(join, left, right);
	// Keeping the runs the two sides can still pair across the seam is the least destructive
	// reading, so it leads; dropping every stranded run answers where markdown cannot rejoin them.
	for (const dangling of [unpairedSpans(join, left, right), everyDanglingSpan(join, left, right)]) {
		const spans = [...dangling, ...pairs];
		const candidate = withoutSpans(join.mergedRaw, spans);
		if (visibleBlockText(candidate) !== shown) continue;
		// A candidate that changed nothing IS the literal join: declining says so, and keeps the
		// caller off a rewrite path it does not need.
		if (candidate === join.mergedRaw) return null;
		// Every byte dropped ahead of the seam moves the caret's landing with it.
		const droppedBefore = spans
			.filter((span) => span.end <= join.seam)
			.reduce((total, span) => total + span.end - span.start, 0);
		return { raw: candidate, seam: join.seam - droppedBefore };
	}
	return null;
};

const standsOnSeam = (side: Side): boolean => side.dangling.length > 0 || side.touching.length > 0;

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
function readSide(endpoint: JoinEndpoint, keep: 'before' | 'after'): Side | null {
	const { node, offset } = endpoint;
	if (!isProseKind(node.kind)) return null;
	const content = getContentRange(node);
	if (offset < content.start || offset > content.end) return null;

	const constructs = policyConstructs(parseInline(node.raw, content.start, content.end));
	if (constructs === null) return null;
	const dangling = constructs.filter((c) => c.content.start < offset && offset < c.content.end);
	if (dangling.some((c) => !isRejoinable(c.kind))) return null;

	return {
		raw: node.raw,
		content,
		cut: offset,
		dangling,
		touching: touchingChain(constructs, offset, keep)
	};
}

/** Every construct with a content range, outermost first — or null when one straddling the seam
 *  has none, which is a decline the caller reads as "leave the bytes alone". */
function policyConstructs(inlines: readonly InlineNode[]): SideConstruct[] | null {
	const found: SideConstruct[] = [];
	let opaque = false;
	const visit = (nodes: readonly InlineNode[]): void => {
		for (const node of nodes) {
			if (node.kind === 'text') continue;
			const content = constructContentRange(node);
			if (!content) {
				opaque = true;
				continue;
			}
			found.push({ kind: node.kind, node: { start: node.start, end: node.end }, content });
			if (node.children) visit(node.children);
		}
	};
	visit(inlines);
	return opaque ? null : found;
}

/** Whether the family declares its delimiters cuttable and rejoinable at all (§ 4.4). */
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
 * What the reader is owed: each side's surviving content as it painted, with every stranded run
 * gone. A run whose partner the cut took prints LITERALLY, so it is not something the reader saw
 * and not something the join may keep — which is exactly the claim § 4.5 makes for the seam.
 */
function shownAfterJoin(left: Side, right: Side): string {
	const leftText = withoutSpans(
		left.raw.slice(left.content.start, left.cut),
		left.dangling.map((c) => shift(openerRun(c), -left.content.start))
	);
	const rightText = withoutSpans(
		right.raw.slice(right.cut, right.content.end),
		right.dangling.map((c) => shift(closerRun(c), -right.cut))
	);
	return visibleText(leftText) + visibleText(rightText);
}

const shift = (span: Span, by: number): Span => ({ start: span.start + by, end: span.end + by });

/** What a reader sees, asked of the thing that paints it: the render path's own DOM with every
 *  marker span dropped. A private walk cannot know which bytes a kind hides. */
function visibleText(raw: string): string {
	return renderedText(parseInline(raw, 0, raw.length), raw);
}

/** The candidate read back as a block: a join produces ONE, and a candidate that parses to two
 *  (or to a kind with no inline content) is not the thing the caller is about to install. */
function visibleBlockText(raw: string): string | null {
	const blocks = parse(raw, { scope: 'fragment' }).children;
	if (blocks.length !== 1 || !isProseKind(blocks[0].kind)) return null;
	const block = blocks[0];
	const range = getContentRange(block);
	return renderedText(parseInline(block.raw, range.start, range.end), block.raw);
}
