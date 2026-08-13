/**
 * The live-mode gesture fuzzer: a seeded stream of typing and destructive gestures at hidden-edge
 * positions, each checked against live-mode.md § 2's license. Every oracle is per gesture and, where
 * the byte-literal edit already diverges, differential against a twin run of the same gesture.
 */

import fc from 'fast-check';
import { makeRng, type Rng } from '$lib/e2e/simulation/rng';
import type { CstNode, Document, InlineNode } from '$lib/core/nodes';
import type { EdgeAffinity } from '$lib/cursor/edge-affinity';
import { isBlankParagraph, parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { constructContentRange, getContentRange, parseInline } from '$lib/core/inline';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { isSubsequence, keepsEveryByte } from '$lib/test/harness/live-oracles';
import { arbLiveDoc } from '$lib/test/invariants/arbitraries';
import { takeDevWarns } from '$lib/test/support/warn-gate';
import {
	chromePaints,
	documentContentText,
	hiddenEdgeOffsets,
	normalizeScreen,
	proseLeaves,
	unpaintedResidue
} from './live-screen-reading';
import {
	applyGesture,
	gestureSites,
	gestureTargets,
	resetSurfaces,
	type Applied,
	type Gesture,
	type GestureKind
} from './live-gesture-seams';

// ── What a run reports ───────────────────────────────────────────────────────

/**
 * `seam` is live diverging where the byte-literal twin holds: a defect, and what the sweep gates on.
 * `ambiguous` is both arms failing the same absolute claim — markdown's own rebinding, or the
 * byte-literal fallback § 4.4 declares (#118). `known` is a live-only divergence an open ledger issue
 * already owns, named by {@link seatIssue} and pinned by its own case.
 */
export type ViolationCategory = 'seam' | 'ambiguous' | 'known';

export interface Violation {
	oracle: string;
	category: ViolationCategory;
	report: string;
}

export interface FuzzStats {
	docs: number;
	gestures: number;
	applied: number;
	claimed: number;
	rewrote: Record<GestureKind, number>;
	violations: Violation[];
}

export interface FuzzOptions {
	seed: number;
	docs: number;
	steps: number;
}

// ── The draw ─────────────────────────────────────────────────────────────────

const KIND_WEIGHTS: { value: GestureKind; weight: number }[] = [
	{ value: 'type', weight: 3 },
	{ value: 'backspace', weight: 3 },
	{ value: 'delete', weight: 2 },
	{ value: 'enter', weight: 2 },
	{ value: 'range-delete', weight: 3 },
	{ value: 'type-over', weight: 2 }
];

const TYPED = ['a', 'Z', '1', ' ', '.', '汉', '😀'];
const AFFINITIES: (EdgeAffinity | null)[] = ['near', 'far', 'outside', null];

/** Hidden-edge biased, because a uniform draw meets a zero-width run only by accident. */
function drawOffset(rng: Rng, node: CstNode | undefined): number {
	if (!node) return 0;
	const { start, end } = getContentRange(node);
	const edges = hiddenEdgeOffsets(node);
	if (edges.length > 0 && rng.chance(0.7)) return rng.pick(edges) - start;
	return rng.int(0, Math.max(1, end - start + 1));
}

function drawGesture(rng: Rng, source: string): Gesture {
	const doc = parse(source);
	const kind = rng.weightedPick(KIND_WEIGHTS);
	const targets = gestureTargets(doc, kind);
	const leaf = rng.int(0, Math.max(1, targets.length));
	const endLeaf = rng.int(0, Math.max(1, targets.length));
	return {
		kind,
		leaf,
		endLeaf,
		offset: drawOffset(rng, targets[leaf]?.node),
		endOffset: drawOffset(rng, targets[endLeaf]?.node),
		char: rng.pick(TYPED),
		affinity: rng.pick(AFFINITIES)
	};
}

// ── The oracles ──────────────────────────────────────────────────────────────

/**
 * The screen shows what the gesture claimed: an insertion adds exactly what was typed, a split adds
 * exactly one line break, and a destructive press may only take glyphs away. Read as the content
 * behind every marker family, which is the before/after conservation diff § 2 names: chrome folds the
 * moment content arrives, and a screen-side reading would report that fold as bytes lost.
 */
function screenClaimHolds(gesture: Gesture, before: string, after: string): boolean {
	if (gesture.kind === 'type') return insertsSomewhere(before, after, gesture.char);
	if (gesture.kind === 'enter') return insertsSomewhere(before, after, '\n');
	const target = normalizeScreen(after);
	if (gesture.kind === 'type-over') {
		// The typed run may also have collapsed against a line end, so its absence is a candidate too.
		return removals(target, gesture.char).some((rest) =>
			isSubsequence(rest, normalizeScreen(before))
		);
	}
	return isSubsequence(target, normalizeScreen(before));
}

/** Whether `after` reads as `before` with `inserted` added at one position, once both are read the
 *  way the screen paints them — inserting into a terminal run changes no glyph at all. */
function insertsSomewhere(before: string, after: string, inserted: string): boolean {
	const target = normalizeScreen(after);
	for (let at = 0; at <= before.length; at++) {
		if (normalizeScreen(before.slice(0, at) + inserted + before.slice(at)) === target) return true;
	}
	return false;
}

const removals = (text: string, run: string): string[] => [
	text,
	...[...text.matchAll(new RegExp(escapeRegExp(run), 'g'))].map(
		(m) => text.slice(0, m.index) + text.slice(m.index + run.length)
	)
];

const escapeRegExp = (run: string): string => run.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Delimiter bytes a construct can paint. `_` stays out: underscore emphasis is intraword-restricted,
 *  so a byte against `__x__` kills the pair from either side whatever a seam answers. */
const delimitersOnScreen = (text: string): number => (text.match(/[*~`<>[\]]/g) ?? []).length;

type ScreenIssue = '#116' | '#162' | '#165';

/**
 * The open ledger issue a live-only screen divergence belongs to, scoped to the SHAPE each one's own
 * pin asserts so a fix reds the pin and takes the exclusion with it. `#116` is a byte landing against
 * a shared asterisk run; `#162` is the unverified seat's three shapes; `#165` is the selection
 * replace splicing typed bytes into a candidate it already verified. Everything else still gates.
 */
function seatIssue(doc: Document, gesture: Gesture, rewrote: boolean): ScreenIssue | null {
	// The splice happens only where the cleanup produced something to splice into.
	if (gesture.kind === 'type-over') return rewrote ? '#165' : null;
	if (gesture.kind !== 'type') return null;
	for (const { node, offset } of gestureSites(doc, gesture)) {
		const near = (start: number, end: number) => offset >= start - 1 && offset <= end + 1;
		const runsOf = (pattern: RegExp) =>
			[...node.raw.matchAll(pattern)].some((run) => near(run.index, run.index + run[0].length));
		if (runsOf(/\*{3,}/g)) return '#116';
		// A run opens and closes against a word, never whitespace, and the `_`/`~` families pair only
		// outside one — so on those the seat's outer side kills the pair its inner side would keep.
		if (gesture.char.trim() === '' && runsOf(/[*_~`<>[\]]+/g)) return '#162';
		if (runsOf(/[_~]+/g)) return '#162';
		const range = getContentRange(node);
		const empty = (nodes: readonly InlineNode[]): boolean =>
			nodes.some((inline) => {
				// `text` is excluded before the content test, not after: a bare run has no content range
				// at all, so counting it as chrome standing over nothing would excuse every prose site.
				const content = constructContentRange(inline);
				const paintsNothing =
					inline.kind !== 'text' && (content === null || content.start === content.end);
				return (
					(paintsNothing && near(inline.start, inline.end)) ||
					(inline.children ? empty(inline.children) : false)
				);
			});
		if (empty(parseInline(node.raw, range.start, range.end))) return '#162';
	}
	return null;
}

/**
 * The open ledger issue a live-only reload divergence belongs to, matched on the divergence AND on
 * the shape each one's pin asserts, so the exclusion cannot widen past it. `#163` is the join
 * cleaner leaving a space against a list marker; `#164` is a rebalanced split whose EMPTY first half
 * reloads as its predecessor's separator, which is a blank block the twin's split does not write.
 */
function shapeIssue(
	gesture: Gesture,
	divergence: string,
	live: Applied,
	literal: Applied
): '#163' | '#164' | null {
	if (gesture.kind === 'enter') {
		const children = divergence.match(/live has (\d+) children, reparsed has (\d+)/);
		if (!children || Number(children[1]) !== Number(children[2]) + 1) return null;
		return blankBlocks(live.doc) > blankBlocks(literal.doc) ? '#164' : null;
	}
	if (gesture.kind === 'type') return null;
	return /listItem\.marker: live "- " != reparsed "-\s+"/.test(divergence) ? '#163' : null;
}

const blankBlocks = (doc: Document): number => doc.children.filter(isBlankParagraph).length;

/** The longest run of one delimiter byte. A join splice abuts two runs into a longer shared one,
 *  which is #136's mechanism and what tells it from a residue pair that was already there. */
function longestRun(bytes: string, byte: string): number {
	return [...bytes.matchAll(new RegExp(`\\${byte}+`, 'g'))].reduce(
		(longest, run) => Math.max(longest, run[0].length),
		0
	);
}

/**
 * The § 2 license over bytes, per gesture family. Typing loses nothing; a split keeps every byte but
 * a line ending; a destructive press only removes. The two range gestures cut a span the byte-literal
 * twin cuts identically, so there the twin is the upper bound — but a caret-edge press deliberately
 * takes a DIFFERENT character than native (§ 4.4), which makes the twin no bound at all.
 */
function bytesConserved(gesture: Gesture, before: string, live: string, literal: string): boolean {
	if (gesture.kind === 'type') return isSubsequence(inked(before), inked(live));
	if (gesture.kind === 'enter') return keepsEveryByte(before, live);
	if (gesture.kind === 'backspace' || gesture.kind === 'delete') {
		return isSubsequence(inked(live), inked(before));
	}
	// The swallow: an arm that owns a press but has no sound rewrite writes nothing (§ 4.4).
	return live === before || isSubsequence(inked(live), inked(literal));
}

/**
 * Whitespace out. A structural edit mints and drops line endings by design (a split adds one, an
 * emptied block gains a separator) and a join REORDERS the run around its seam, both of which an
 * ordered containment check reads as bytes lost. The narrowing is stated rather than hidden: no arm
 * that takes this reading sees a dropped mid-line space. Only `enter` still does, through
 * `keepsEveryByte`; the destructive and typing families do not, and #106 makes only TERMINAL
 * whitespace a declared drop.
 */
const inked = (bytes: string): string => bytes.replace(/\s+/g, '');

/**
 * § 4.1's residue, counted two ways: a construct the parse still reads as delimiters enclosing
 * nothing inside a block whose chrome does not paint, and an abutted run the parse no longer reads
 * as a construct at all. Differential, since a drawn document may already hold either.
 */
function residueCount(doc: Document): number {
	let empty = 0;
	for (const { node } of proseLeaves(doc)) {
		if (chromePaints(node)) continue;
		const range = getContentRange(node);
		if (range.end > node.raw.length) continue;
		const visit = (nodes: readonly InlineNode[]): void => {
			for (const inline of nodes) {
				const content = constructContentRange(inline);
				if (content && content.start === content.end && inline.end > inline.start) empty++;
				if (inline.children) visit(inline.children);
			}
		};
		visit(parseInline(node.raw, range.start, range.end));
	}
	return empty + unpaintedResidue(doc);
}

// ── The run ──────────────────────────────────────────────────────────────────

export async function fuzzLiveGestures(options: FuzzOptions): Promise<FuzzStats> {
	const sources = fc.sample(arbLiveDoc, { numRuns: options.docs, seed: options.seed });
	const stats: FuzzStats = {
		docs: sources.length,
		gestures: 0,
		applied: 0,
		claimed: 0,
		rewrote: { type: 0, backspace: 0, delete: 0, enter: 0, 'range-delete': 0, 'type-over': 0 },
		violations: []
	};
	for (const [index, source] of sources.entries()) {
		const rng = makeRng(options.seed + index * 7919);
		let current = source;
		for (let step = 0; step < options.steps; step++) {
			const gesture = drawGesture(rng, current);
			stats.gestures++;
			resetSurfaces();
			const live = await applyGesture(current, gesture, 'live');
			const liveWarns = takeDevWarns();
			resetSurfaces();
			const literal = await applyGesture(current, gesture, undefined);
			const literalWarns = takeDevWarns();
			resetSurfaces();
			if (!live || !literal) continue;
			stats.applied++;
			if (live.claimed) stats.claimed++;
			if (live.bytes !== literal.bytes) stats.rewrote[gesture.kind]++;
			const found = judge(gesture, current, live, literal);
			// A dev guard that fired is a finding in its own right: the fuzzer is the caller that
			// provoked it, and which of the two arms provoked it is the same question every oracle asks.
			if (liveWarns.length > 0) {
				found.push({
					oracle: 'dev-warn',
					category: liveWarns.length > literalWarns.length ? 'seam' : 'ambiguous',
					report:
						`${liveWarns.map((w) => `${w.tag} ${w.message}`).join(' | ')}\n` +
						`  before ${JSON.stringify(current)}\n  live   ${JSON.stringify(live.bytes)}`
				});
			}
			for (const violation of found) {
				stats.violations.push({
					...violation,
					report: `seed ${options.seed} doc ${index} step ${step}: ${violation.report}`
				});
			}
			current = live.bytes;
		}
	}
	return stats;
}

function judge(gesture: Gesture, before: string, live: Applied, literal: Applied): Violation[] {
	const out: Violation[] = [];
	const say = (oracle: string, category: ViolationCategory, detail: string) =>
		out.push({
			oracle,
			category,
			report:
				`${oracle} — ${detail}\n  gesture ${gesture.kind} leaf ${gesture.leaf}@${gesture.offset} ` +
				`char ${JSON.stringify(gesture.char)} affinity ${gesture.affinity}\n` +
				`  before  ${JSON.stringify(before)}\n  live    ${JSON.stringify(live.bytes)}\n` +
				`  literal ${JSON.stringify(literal.bytes)}`
		});

	const liveShape = describeConvergence(live.doc);
	if (liveShape && describeConvergence(literal.doc) === null) {
		const owner = shapeIssue(gesture, liveShape, live, literal);
		say('shape', owner ? 'known' : 'seam', `${owner ? `${owner} ` : ''}${liveShape}`);
	}
	const roundTrips = (bytes: string) => serialize(parse(bytes)) === bytes;
	if (!roundTrips(live.bytes) && roundTrips(literal.bytes)) {
		say('round-trip', 'seam', 'live bytes do not reparse to themselves');
	}

	const start = parse(before);
	const screenBefore = documentContentText(start);
	const liveScreen = documentContentText(live.doc);
	const literalScreen = documentContentText(literal.doc);
	const literalHolds = screenClaimHolds(gesture, screenBefore, literalScreen);
	const issue = seatIssue(start, gesture, live.bytes !== literal.bytes);
	// Only the seat's own numbers reach the screen-shaped pair; a lost byte or a broken reload stays
	// `seam` whatever the shape, since no rebinding can excuse one.
	const excused: ViolationCategory | null = issue ? 'known' : null;

	if (!screenClaimHolds(gesture, screenBefore, liveScreen)) {
		say(
			'screen',
			literalHolds ? (excused ?? 'seam') : 'ambiguous',
			`${issue ?? ''} screen went ${JSON.stringify(screenBefore)} → ${JSON.stringify(liveScreen)}`
		);
	}
	// One-sided, as it is in the seat's own net: whatever the parse rebinds, a rewrite may never put
	// MORE delimiters on screen than the document already showed. Stated against BEFORE rather than
	// against the twin, because the byte-literal edit can FORM a construct by accident and hide runs
	// live correctly kept. A press live SWALLOWED wrote nothing, so it makes no claim at all (§ 4.4).
	const shown = delimitersOnScreen(liveScreen);
	if (live.bytes !== before && shown > delimitersOnScreen(screenBefore)) {
		const alsoLiteral = delimitersOnScreen(literalScreen) >= shown;
		say(
			'delimiters',
			alsoLiteral ? 'ambiguous' : (excused ?? 'seam'),
			`live shows ${JSON.stringify(liveScreen)} for ${JSON.stringify(screenBefore)}`
		);
	}

	if (!bytesConserved(gesture, before, live.bytes, literal.bytes)) {
		say('bytes', 'seam', 'live wrote bytes its gesture family may not write');
	}
	// Against the document the gesture STARTED from: § 4.1 forbids writing residue, and a twin that
	// happened to destroy a pre-existing run would otherwise read as live having minted one.
	if (residueCount(live.doc) > residueCount(start)) {
		// Where the twin wrote the same bytes, nothing live did minted it. #136 is the join cleaner's
		// splice abutting two asterisk runs into a shared one; a type gesture's residue is whatever
		// the unverified seat left, so it takes the seat's number.
		const minted = live.bytes !== literal.bytes;
		const owner = !minted
			? null
			: gesture.kind === 'type'
				? seatIssue(start, gesture, minted)
				: longestRun(live.bytes, '*') > longestRun(before, '*')
					? '#136'
					: null;
		say(
			'residue',
			!minted ? 'ambiguous' : owner ? 'known' : 'seam',
			`${owner ? `${owner} ` : ''}live minted a delimiter pair enclosing nothing`
		);
	}
	return out;
}
