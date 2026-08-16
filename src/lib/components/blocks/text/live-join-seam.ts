/**
 * The live-mode join rewrite (live-mode.md § 4.5): a literal concatenation surfaces the runs a
 * truncation left unpaired and the closer/opener pair a split's inverse abuts around nothing. Both
 * are dropped here and nowhere else, and only once the joined block re-parses to ONE prose block
 * showing what the two sides showed.
 */

import {
	constructContentRange,
	getContentRange,
	isProseKind,
	parseInline
} from '../../../core/inline';
import {
	CONTENT_VISIBILITY,
	paintsOnlyChrome,
	renderedText
} from '../../../core/inline/visibility';
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

	// The caller splices `typed` at the seam once this returns, so the bytes verified below are the
	// bytes written: a typed run changes the flanking a kept delimiter pairs against.
	const typed = join.typed ?? '';
	const shown = shownAfterJoin(left, right, typed);
	const pairs = abuttingPairSpans(join, left, right);
	// Least destructive first: keep the runs the two sides can still pair across the seam, and fall
	// back to dropping every stranded one. Identical readings render once.
	const readings = [unpairedSpans(join, left, right), everyDanglingSpan(join, left, right)];
	const spanSets = readings.map((dangling) => [...dangling, ...pairs]);
	const candidates = (sameSpans(spanSets[0], spanSets[1]) ? [spanSets[0]] : spanSets).map(
		(spans) => {
			const raw = withoutSpans(join.mergedRaw, spans);
			const seam = join.seam - droppedBefore(spans, join.seam);
			return {
				spans,
				raw,
				seam,
				read: readCandidate(raw.slice(0, seam) + typed + raw.slice(seam), resolver, join)
			};
		}
	);
	// § 4.1's other half: a run the leanest reading keeps can be one the cut left enclosing nothing,
	// and a pair over nothing passes the screen check. Least destructive is read among the rest.
	const floor = Math.min(...candidates.map(({ read }) => read?.residue ?? Infinity));
	for (const { raw: candidate, seam, read } of candidates) {
		if (read === null || read.visible !== shown || read.residue > floor) continue;
		// A candidate that changed nothing IS the literal join: declining says so, and keeps the
		// caller off a rewrite path it does not need.
		if (candidate === join.mergedRaw) return null;
		// The split half's terminal-trivia rule, on the join: a whitespace-only survivor paints
		// nothing and reloads as blank trivia, a different shape than the block written.
		const display = trimTrailingLineEnding(candidate);
		if (display !== '' && display.trim() === '') {
			return { raw: candidate.slice(display.length), seam: 0 };
		}
		return { raw: candidate, seam };
	}
	return null;
};

/** Every byte a reading drops ahead of the seam moves the caret's landing with it. */
const droppedBefore = (spans: readonly Span[], seam: number): number =>
	spans
		.filter((span) => span.end <= seam)
		.reduce((total, span) => total + span.end - span.start, 0);

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
 * the cleanup has no business running: a non-prose kind, an offset outside the content, or a cut
 * through a family that declares no close-and-reopen, whose bytes mean nothing apart.
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
	// Chrome standing over nothing is all on screen (live-mode.md § 4.1), so a run surviving this
	// cut is bytes the reader saw, not a stranded one: the literal join stands.
	if (paintsOnlyChrome(inlines, node.raw)) return null;
	const { ranged, atomic } = classifyConstructs(inlines);
	// Neither an atomic construct's interior nor the middle of a delimiter run leaves halves any
	// reading of the seam can repair. Live's caret cannot land there; a plugin's can.
	if (atomic.some((span) => offset > span.start && offset < span.end)) return null;
	if (ranged.some((c) => splitsARun(c, offset))) return null;
	// Dangling is about the PARTNER, so content-range containment is not the test: a cut at a
	// construct's content start leaves its opener behind just as one in the middle does.
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
 * pre-join parse, never off the joined halves — either of those bakes the defect this checks for
 * into its own expectation.
 */
const shownAfterJoin = (left: Side, right: Side, typed: string): string =>
	visibleSide(left, 'before') + typed + visibleSide(right, 'after');

/**
 * What a reader sees, asked of the thing that paints it: the render path's own DOM with every
 * marker span dropped. The clip decides only WHERE the bytes stop; a construct the cut crosses
 * contributes its content, since its delimiter runs paint nothing either way — which `readSide`
 * has already established by declining a side whose chrome paints.
 */
function visibleSide(side: Side, keep: 'before' | 'after'): string {
	return renderedText(clipNodes(side.inlines, side.cut, keep), side.raw, CONTENT_VISIBILITY);
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

/**
 * The candidate read back as the caller will install it: what it shows, and how many constructs its
 * row unwraps are left standing over nothing. Null where a join produces something the caller cannot
 * install — two blocks, a kind with no inline content, or a body the container would re-read.
 */
function readCandidate(
	raw: string,
	resolver: LinkReferenceResolver | undefined,
	join: { ambientPrefix?: string }
): { visible: string; residue: number } | null {
	if (!keepsContainerMarker(join.ambientPrefix ?? '', raw)) return null;
	const blocks = parse(raw, { scope: 'fragment' }).children;
	if (blocks.length !== 1 || !isProseKind(blocks[0].kind)) return null;
	const block = blocks[0];
	const range = getContentRange(block);
	const nodes = parseInline(block.raw, range.start, range.end, resolver);
	return {
		visible: renderedText(nodes, block.raw, CONTENT_VISIBILITY),
		// Chrome standing over nothing is all on screen (§ 4.1), so a block that paints hides no pair.
		residue: paintsOnlyChrome(nodes, block.raw) ? 0 : countResidue(nodes, block.raw)
	};
}

/**
 * Whether the container still reads its own marker off the candidate. The item's marker is not in
 * these bytes but absorbs from them, so a body the cut left starting with a space reloads under a
 * WIDER marker than the live tree holds — the load/save cycle would then change the tree.
 */
function keepsContainerMarker(prefix: string, raw: string): boolean {
	if (prefix === '') return true;
	const blocks = parse(prefix + raw, { scope: 'fragment' }).children;
	if (blocks.length !== 1) return false;
	return (blocks[0] as { marker?: string }).marker === prefix;
}

/** Constructs the reader would meet as nothing at all: no painted byte, and a row that unwraps
 *  them when emptied rather than leaving delimiters over nothing. */
function countResidue(nodes: readonly InlineNode[], raw: string): number {
	let found = 0;
	for (const node of nodes) {
		if (node.kind === 'text') continue;
		if (
			node.end > node.start &&
			renderedText([node], raw, CONTENT_VISIBILITY) === '' &&
			getInlineConstructPolicy(node.kind)?.autoUnwrapOnEmpty === true
		) {
			found++;
		}
		if (node.children) found += countResidue(node.children, raw);
	}
	return found;
}
