/**
 * The live-mode gesture fuzzer: a seeded stream of typing and destructive gestures at hidden-edge
 * positions, each checked against live-mode.md § 2's license. Every oracle is per gesture and, where
 * the byte-literal edit already diverges, differential against a twin run of the same gesture.
 */

import fc from 'fast-check';
import { makeRng, type Rng } from '$lib/e2e/simulation/rng';
import type { CstNode, Document, InlineNode } from '$lib/core/nodes';
import type { EdgeAffinity } from '$lib/cursor/edge-affinity';
import { parse } from '$lib/core/parser';
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

/**
 * The open ledger issue a live-only screen divergence belongs to, each pinned by its own case so a
 * fix reds the pin and takes the exclusion with it. `#162` owns every seat relocation, the seat
 * being the one live rewrite that verifies no candidate at all; `#116` is the older, narrower number
 * for the instance where the run the byte lands against is shared between a nested pair.
 */
function seatIssue(doc: Document, gesture: Gesture): '#116' | '#162' | null {
	if (gesture.kind !== 'type') return null;
	const shared = gestureSites(doc, gesture).some(({ node, offset }) =>
		[...node.raw.matchAll(/\*{3,}/g)].some(
			(run) => offset >= run.index - 1 && offset <= run.index + run[0].length + 1
		)
	);
	return shared ? '#116' : '#162';
}

/**
 * The open ledger issue a live-only reload divergence belongs to, matched on the divergence the
 * oracle reports so the exclusion cannot widen past the shape that earned it.
 *
 * `#163`: a cleaned join inside a list item leaves the body starting with a space, which the reload
 * folds into the marker. `#164`: a rebalanced split whose first half comes out empty writes a block
 * the reload reads as its predecessor's separator.
 */
function shapeIssue(divergence: string): '#163' | '#164' | null {
	if (/listItem\.marker: live "- " != reparsed "-\s+"/.test(divergence)) return '#163';
	const children = divergence.match(/live has (\d+) children, reparsed has (\d+)/);
	return children && Number(children[1]) === Number(children[2]) + 1 ? '#164' : null;
}

/** Markdown's own rule rather than a seam's choice: underscore emphasis is intraword-restricted, so
 *  a byte against `__x__` from either outside edge kills the pair whatever a seat answers. */
function intrawordUnderscore(doc: Document, gesture: Gesture): boolean {
	return gestureSites(doc, gesture).some(({ node, offset }) =>
		[...node.raw.matchAll(/_+/g)].some(
			(run) => offset >= run.index - 1 && offset <= run.index + run[0].length + 1
		)
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

/** Whitespace out: a join REORDERS the trivia around its seam (a trailing run moves ahead of the
 *  line endings it followed), which is the block primitive's business in every mode, and an ordered
 *  containment check would report that reordering as bytes the rewrite lost. */
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
		const owner = shapeIssue(liveShape);
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
	// Only the seat's own number and markdown's intraword rule reach the screen-shaped pair; a lost
	// byte stays `seam` whatever the shape, since no rebinding can excuse one.
	const screenCategory = (): ViolationCategory => {
		if (!literalHolds || intrawordUnderscore(start, gesture)) return 'ambiguous';
		return seatIssue(start, gesture) ? 'known' : 'seam';
	};
	const issue = seatIssue(start, gesture);

	if (!screenClaimHolds(gesture, screenBefore, liveScreen)) {
		say(
			'screen',
			screenCategory(),
			`${issue ?? ''} screen went ${JSON.stringify(screenBefore)} → ${JSON.stringify(liveScreen)}`
		);
	}
	// The tie-break inside the ambiguous bucket, one-sided as it is in the seat's own net: where
	// neither arm can keep the screen, live may still never put MORE delimiters on it than the
	// byte-literal edit does. Outside that bucket the claim above already answers, and a literal edit
	// that happens to FORM a construct would make this fire on a live result that is simply right.
	if (!literalHolds && delimitersOnScreen(liveScreen) > delimitersOnScreen(literalScreen)) {
		say(
			'delimiters',
			screenCategory(),
			`live shows ${JSON.stringify(liveScreen)} for ${JSON.stringify(literalScreen)}`
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
				? seatIssue(start, gesture)
				: /\*{4,}/.test(live.bytes)
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
