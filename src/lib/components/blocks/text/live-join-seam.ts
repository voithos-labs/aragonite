/**
 * The live-mode join rewrite (live-mode.md § 4.5): joining two blocks literally would show the
 * delimiter runs a truncation left unpaired, and the closer/opener pair a split's inverse pushes
 * together around nothing. Both are dropped here and nowhere else, and only once the joined block
 * reparses to one prose block showing what the two sides showed.
 */

import {
	constructContentRange,
	getContentRange,
	inlineDescendants,
	isProseKind,
	parseInline
} from '../../../core/inline';
import {
	CONTENT_VISIBILITY,
	paintsOnlyChrome,
	renderedText
} from '../../../core/inline/visibility';
import { trimTrailingLineEnding } from '../../../core/lines';
import type { Reading } from '../../../schema/reading';
import type { GrammarView } from '../../../schema/block-openers';
import type { RenderInlineOptions } from '../../../core/inline-render';
import type { AnyInlineKind, InlineNode } from '../../../core/nodes';
import { parse } from '../../../core/parser';
import {
	getInlineConstructPolicy,
	type JoinEndpoint,
	type LiveJoinSeamCleaner
} from '../../../schema/inline-construct-policy';
import { soleProseReparse } from './screen-diff';

// ── The rewrite ──────────────────────────────────────────────────────────────

export const cleanLiveJoinSeam: LiveJoinSeamCleaner = (join) => {
	const { reading } = join;
	const left = readSide(join.start, 'before', reading);
	const right = readSide(join.end, 'after', reading);
	if (left === null || right === null) return null;
	// Nothing sits at the join, so the plain concatenation is already the answer, and an ordinary
	// Backspace between two paragraphs pays for no parse.
	if (!standsOnSeam(left) && !standsOnSeam(right)) return null;
	if (!anchorsOnMerged(join, left, right)) return null;

	// The caller splices `typed` at the join once this returns, so the bytes checked below are the
	// bytes written: a typed run changes the flanking a kept delimiter pairs against.
	const typed = join.typed ?? '';
	const shown = shownAfterJoin(left, right, typed);
	const pairs = abuttingPairSpans(join, left, right);
	// Least destructive first: keep the runs the two sides can still pair across the join, and
	// fall back to dropping every stranded one. Two identical readings are tried once.
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
				read: readCandidate(raw.slice(0, seam) + typed + raw.slice(seam), reading, join)
			};
		}
	);
	// The other half of § 4.1: a run the least destructive reading keeps can be one the cut left
	// enclosing nothing, and a pair over nothing passes the screen check, so among the readings
	// that pass, the one leaving the fewest of those wins.
	const floor = Math.min(...candidates.map(({ read }) => read?.residue ?? Infinity));
	for (const { raw: candidate, seam, read } of candidates) {
		if (read === null || read.visible !== shown || read.residue > floor) continue;
		// A candidate that changed nothing is the plain concatenation: refusing says so, and keeps
		// the caller off a rewrite path it does not need.
		if (candidate === join.mergedRaw) return null;
		// The split half's trailing-whitespace rule, applied to the join: a survivor that is only
		// whitespace draws nothing and reparses as a blank line, not the block that was written.
		const display = trimTrailingLineEnding(candidate);
		if (display !== '' && display.trim() === '') {
			return { raw: candidate.slice(display.length), seam: 0 };
		}
		return { raw: candidate, seam };
	}
	return null;
};

/** Every byte a reading drops before the join moves the caret with it. */
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
	/** The editor's grammar, which the render reading of this side draws in. */
	grammar: GrammarView;
	content: Span;
	cut: number;
	inlines: readonly InlineNode[];
	/** Constructs the cut left open: an opener kept without its closer, or the reverse. Outermost
	 *  first, so the two sides' lists compare position by position. */
	dangling: SideConstruct[];
	/** Constructs whose delimiter run touches the cut from inside the surviving bytes: the
	 *  trailing closers of the block above, the leading openers of the block below. */
	touching: SideConstruct[];
}

/**
 * Read one endpoint's surviving bytes and the constructs its cut leaves at the join. Null where
 * the cleanup has no business running: a non-prose kind, an offset outside the content, or a cut
 * through a family that declares no close-and-reopen, whose bytes mean nothing apart.
 */
function readSide(endpoint: JoinEndpoint, keep: 'before' | 'after', reading: Reading): Side | null {
	const { node, offset } = endpoint;
	if (!isProseKind(node.kind)) return null;
	const content = getContentRange(node);
	if (offset < content.start || offset > content.end) return null;

	const inlines = parseInline(
		node.raw,
		content.start,
		content.end,
		reading.current,
		reading.grammar
	);
	// Markers standing over nothing are all on screen (live-mode.md § 4.1), so a run that survives
	// this cut is bytes the user saw, not a stranded one: the plain concatenation stands.
	if (paintsOnlyChrome(inlines, node.raw, { grammar: reading.grammar })) return null;
	const { ranged, atomic } = classifyConstructs(inlines);
	// Neither an atomic construct's interior nor the middle of a delimiter run leaves halves any
	// reading can repair. A live-mode caret cannot land there; a plugin's can.
	if (atomic.some((span) => offset > span.start && offset < span.end)) return null;
	if (ranged.some((c) => splitsARun(c, offset))) return null;
	// What matters is whether the partner delimiter survives, not whether the cut lies inside the
	// content range: a cut at a construct's content start leaves its opener behind too.
	const dangling = ranged.filter((c) =>
		keep === 'before'
			? c.content.start <= offset && offset < c.node.end
			: c.node.start < offset && offset <= c.content.end
	);
	if (dangling.some((c) => !isRejoinable(c.kind))) return null;

	return {
		raw: node.raw,
		grammar: reading.grammar,
		content,
		cut: offset,
		inlines,
		dangling,
		touching: touchingChain(ranged, offset, keep)
	};
}

/** Text is content, not a construct, and nothing under it is one either. The two scans below
 *  share this test when they descend. */
const isConstruct = (node: InlineNode): boolean => node.kind !== 'text';

/** Constructs with a content range (outermost first), kept apart from those without one, whose
 *  bytes the join can only step around. */
function classifyConstructs(inlines: readonly InlineNode[]): {
	ranged: SideConstruct[];
	atomic: Span[];
} {
	const ranged: SideConstruct[] = [];
	const atomic: Span[] = [];
	for (const node of inlineDescendants(inlines, isConstruct)) {
		if (node.kind === 'text') continue;
		const content = constructContentRange(node);
		if (!content) {
			atomic.push({ start: node.start, end: node.end });
			continue;
		}
		ranged.push({ kind: node.kind, node: { start: node.start, end: node.end }, content });
	}
	return { ranged, atomic };
}

const splitsARun = (c: SideConstruct, at: number): boolean =>
	(at > c.node.start && at < c.content.start) || (at > c.content.end && at < c.node.end);

/** Whether the family declares its delimiters cuttable and rejoinable at all (live-mode.md § 4.4). */
function isRejoinable(kind: AnyInlineKind): boolean {
	return getInlineConstructPolicy(kind)?.splitBehavior === 'close-and-reopen';
}

/**
 * The nested chain of closers ending at `cut` (or openers starting there), stripped outermost
 * first: `**a *b***` cut at its end gives the strong emphasis, then the emphasis its closer
 * wraps. This is the shape `live-split-rebalance` writes, read back.
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

/** Whether the merged bytes are still the two sides' bytes end to end. Anything that rewrote
 *  either side moves every offset below, so the cleanup does nothing instead. */
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

/** A left-side span is already in merged coordinates; a right-side one shifts by the join. */
const rightSpan = (join: { seam: number }, right: Side, span: Span): Span => ({
	start: join.seam + span.start - right.cut,
	end: join.seam + span.end - right.cut
});

const openerRun = (c: SideConstruct): Span => ({ start: c.node.start, end: c.content.start });
const closerRun = (c: SideConstruct): Span => ({ start: c.content.end, end: c.node.end });

/** Whether two constructs are written with the same delimiters: the byte-level test for "these
 *  are one construct's two halves", which matching kinds alone cannot make (`__a__` vs `**a**`). */
const sameDelimiters = (left: Side, lc: SideConstruct, right: Side, rc: SideConstruct): boolean =>
	left.raw.slice(lc.node.start, lc.content.start) ===
		right.raw.slice(rc.node.start, rc.content.start) &&
	left.raw.slice(lc.content.end, lc.node.end) === right.raw.slice(rc.content.end, rc.node.end);

/**
 * The runs a truncation stranded that the join does not put back together: the left's opener
 * chain and the right's closer chain, minus the leading pairs whose kinds line up, since those
 * two halves make one construct across the join, which is what the user had.
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
 * written with the same bytes, enclosing nothing between them. The whole chain or nothing:
 * dropping an outer pair while an inner one stays would leave both halves' runs unbalanced.
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
 * What the user must still see: what each side already showed of the bytes that survive. Read off
 * the parse from before the join, never off the joined halves, since either of those would bake
 * the fault this checks for into the expectation.
 */
const shownAfterJoin = (left: Side, right: Side, typed: string): string =>
	visibleSide(left, 'before') + typed + visibleSide(right, 'after');

/** What the user sees of one side, asked of the render with every marker dropped. A construct the
 *  cut crosses still gives its content, since `readSide` refused any side whose markers paint. */
function visibleSide(side: Side, keep: 'before' | 'after'): string {
	return renderedText(clipNodes(side.inlines, side.cut, keep), side.raw, CONTENT_VISIBILITY, {
		grammar: side.grammar
	});
}

/**
 * The `keep` side of `level`, rebuilt: a construct the cut crosses hands its place to its own
 * clipped children. Exported for the depth test, which has to reach the rebuild with a tree no
 * real side could be rendered at.
 */
export function clipNodes(
	level: readonly InlineNode[],
	cut: number,
	keep: 'before' | 'after'
): InlineNode[] {
	const before = keep === 'before';
	// A crossed construct is emitted as its children, in its own place, so the pre-order's
	// emission order is the rebuilt list's order.
	const crossed = (node: InlineNode): boolean =>
		isConstruct(node) && node.start < cut && node.end > cut;
	const out: InlineNode[] = [];
	for (const node of inlineDescendants(level, crossed)) {
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
		if (node.children && node.children.length > 0) continue;
		// A code span carries its content as bytes rather than children, so the surviving part of
		// it is that byte range read as text, which is exactly what the span shows.
		const start = before ? content.start : Math.max(content.start, cut);
		const end = before ? Math.min(content.end, cut) : content.end;
		if (end > start) out.push({ kind: 'text', start, end });
	}
	return out;
}

/**
 * The candidate read back the way the caller will store it: what it shows, and how many constructs
 * whose policy unwraps them are left standing over nothing. Null where a join produces something
 * the caller cannot store: two blocks, a kind with no inline content, or a body the container
 * would read differently.
 */
function readCandidate(
	raw: string,
	reading: Reading,
	join: { ambientPrefix?: string }
): { visible: string; residue: number } | null {
	if (!keepsContainerMarker(join.ambientPrefix ?? '', raw, reading.grammar)) return null;
	const sole = soleProseReparse(raw, reading);
	if (sole === null) return null;
	const { block, nodes } = sole;
	const render = { grammar: reading.grammar };
	return {
		visible: renderedText(nodes, block.raw, CONTENT_VISIBILITY, render),
		// Markers over nothing are all on screen (§ 4.1), so a block that shows them hides no pair.
		residue: paintsOnlyChrome(nodes, block.raw, render) ? 0 : countResidue(nodes, block.raw, render)
	};
}

/**
 * Whether the container still reads its own marker off the candidate. A list item's marker is not
 * in these bytes but takes width from them, so a body the cut left starting with a space reparses
 * under a wider marker than the live tree holds, and a load-then-save cycle would change the tree.
 */
function keepsContainerMarker(prefix: string, raw: string, grammar: GrammarView): boolean {
	if (prefix === '') return true;
	const blocks = parse(prefix + raw, { grammar, scope: 'fragment' }).children;
	if (blocks.length !== 1) return false;
	return (blocks[0] as { marker?: string }).marker === prefix;
}

/** Constructs the user would meet as nothing at all: no visible byte, and a policy that unwraps
 *  them when emptied rather than leaving delimiters over nothing. */
function countResidue(
	nodes: readonly InlineNode[],
	raw: string,
	render: RenderInlineOptions
): number {
	let found = 0;
	for (const node of inlineDescendants(nodes, isConstruct)) {
		if (node.kind === 'text') continue;
		if (
			node.end > node.start &&
			renderedText([node], raw, CONTENT_VISIBILITY, render) === '' &&
			getInlineConstructPolicy(node.kind)?.autoUnwrapOnEmpty === true
		) {
			found++;
		}
	}
	return found;
}
