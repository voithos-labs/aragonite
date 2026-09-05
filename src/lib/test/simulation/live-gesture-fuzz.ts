/**
 * The live-mode gesture fuzzer: a seeded stream of typing and destructive gestures at hidden-edge
 * positions, each checked against live-mode.md § 2's license. Every oracle is per gesture and, where
 * the byte-literal edit already diverges, differential against a twin run of the same gesture.
 */

import fc from 'fast-check';
import { makeRng, type Rng } from '$lib/e2e/simulation/rng';
import type { CstNode, Document } from '$lib/core/nodes';
import type { EdgeAffinity } from '$lib/cursor/edge-affinity';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { getContentRange } from '$lib/core/inline';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { isSubsequence, keepsEveryByte } from '$lib/test/harness/live-oracles';
import { listInlineMarks } from '$lib/schema/inline-construct-policy';
import { arbLiveDoc } from '$lib/test/invariants/arbitraries';
import { takeDevWarns } from '$lib/test/support/warn-gate';
import {
	documentContentText,
	hiddenEdgeOffsets,
	normalizeScreen,
	unpaintedResidue
} from './live-screen-reading';
import {
	applyGesture,
	drawnMark,
	drawsMidScalar,
	gestureTargets,
	resetSurfaces,
	scalarInteriors,
	type Applied,
	type Gesture,
	type GestureKind
} from './live-gesture-seams';

/** The characters that can delimit the drawn construct: its rowed run's, plus `_`, the
 *  emphasis-family twin spelling no row names — a strip reads the author's own run off the parse. */
function markAlphabet(entry: ReturnType<typeof drawnMark>): Set<string> {
	const chars = new Set(entry.mark.markerBytes);
	if (chars.has('*')) chars.add('_');
	return chars;
}

// ── What a run reports ───────────────────────────────────────────────────────

/**
 * `seam` is live diverging where the byte-literal twin holds: a defect, and what the sweep gates on,
 * plus the one absolute claim (well-formedness) that gates on either arm. `ambiguous` is both arms
 * failing the same claim — markdown's own rebinding, or a byte-literal fallback § 4.4 declares.
 */
export type ViolationCategory = 'seam' | 'ambiguous';

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
	/** Gestures whose drawn offset landed inside a surrogate pair, per kind. */
	midScalar: Record<GestureKind, number>;
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
	{ value: 'type-in-container', weight: 2 },
	{ value: 'blank-in-container', weight: 2 },
	{ value: 'backspace', weight: 3 },
	{ value: 'delete', weight: 2 },
	{ value: 'enter', weight: 2 },
	{ value: 'range-delete', weight: 3 },
	{ value: 'type-over', weight: 2 },
	{ value: 'format-toggle', weight: 2 },
	{ value: 'cross-format-toggle', weight: 2 },
	{ value: 'word-delete', weight: 2 }
];

const INERT_CHARS = ['a', 'Z', '1', ' ', '.', '汉', '😀'];

/** Block-grammar minting bytes: a pipe opens a row, `#` a heading, `>` a quote, `:` a directive
 *  fence. No registry carries them, unlike the inline delimiters {@link typedVocabulary} reads. */
const BLOCK_MINTING_CHARS = ['|', '#', '>', ':'];

/** Off the mark table for the same reason the `mark` draw is: a delimiter registered tomorrow is
 *  typed tomorrow, rather than frozen into whatever was rowed when this was written. */
function typedVocabulary(): string[] {
	const heads = new Set(listInlineMarks().map(({ mark }) => mark.markerBytes[0]));
	return [...INERT_CHARS, ...BLOCK_MINTING_CHARS, ...heads];
}

const AFFINITIES: (EdgeAffinity | null)[] = ['near', 'far', 'outside', null];

/** Both toggle gestures answer to the same two oracles: one block's span or a range of them. */
const isFormatToggle = (kind: GestureKind): boolean =>
	kind === 'format-toggle' || kind === 'cross-format-toggle';

/** Hidden-edge biased, because a uniform draw meets a zero-width run only by accident — and the
 *  same for a surrogate seam, which is two units wide in a document that is mostly ASCII. */
function drawOffset(rng: Rng, node: CstNode | undefined): number {
	if (!node) return 0;
	const { start, end } = getContentRange(node);
	const edges = hiddenEdgeOffsets(node);
	if (edges.length > 0 && rng.chance(0.7)) return rng.pick(edges) - start;
	const interiors = scalarInteriors(node.raw, start, end);
	if (interiors.length > 0 && rng.chance(0.5)) return rng.pick(interiors) - start;
	return rng.int(0, Math.max(1, end - start + 1));
}

function drawGesture(rng: Rng, doc: Document): Gesture {
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
		char: rng.pick(typedVocabulary()),
		affinity: rng.pick(AFFINITIES),
		// Off the table, so a newly rowed mark is drawn the day it registers rather than wrapping
		// back into the four that were there when this was written.
		mark: rng.int(0, listInlineMarks().length)
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
	// A compound sequence has no single-glyph delta to claim: its seeding write mints a sibling
	// before the drawn one lands. The shape, round-trip and dev-warn oracles are what judge it.
	if (gesture.kind === 'type-in-container' || gesture.kind === 'blank-in-container') return true;
	if (gesture.kind === 'enter') return insertsSomewhere(before, after, '\n');
	// A toggle changes formatting and nothing else, so its claim is the strictest of the family:
	// equality, not containment.
	if (isFormatToggle(gesture.kind)) {
		return normalizeScreen(after) === normalizeScreen(before);
	}
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

/** What the gesture asked to appear on screen, which the delimiter oracle owes it. */
const typedRun = (gesture: Gesture): string =>
	gesture.kind === 'type' || gesture.kind === 'type-over' ? gesture.char : '';

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
	// The coverage model splits and absorbs: one press may strip, move and mint the toggled
	// construct's own delimiters at once, so direction says nothing. The claim is exact instead:
	// outside that construct's delimiter alphabet, live is before, byte for byte.
	if (isFormatToggle(gesture.kind)) {
		const alphabet = markAlphabet(drawnMark(gesture));
		const scrub = (bytes: string) => [...inked(bytes)].filter((ch) => !alphabet.has(ch)).join('');
		return scrub(live) === scrub(before);
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

// ── The run ──────────────────────────────────────────────────────────────────

/** Off the weight table, so a gesture added there is counted the day it is drawn. */
const perKind = (): Record<GestureKind, number> =>
	Object.fromEntries(KIND_WEIGHTS.map(({ value }) => [value, 0])) as Record<GestureKind, number>;

export async function fuzzLiveGestures(options: FuzzOptions): Promise<FuzzStats> {
	const sources = fc.sample(arbLiveDoc, { numRuns: options.docs, seed: options.seed });
	const stats: FuzzStats = {
		docs: sources.length,
		gestures: 0,
		applied: 0,
		claimed: 0,
		rewrote: perKind(),
		midScalar: perKind(),
		violations: []
	};
	for (const [index, source] of sources.entries()) {
		const rng = makeRng(options.seed + index * 7919);
		let current = source;
		for (let step = 0; step < options.steps; step++) {
			const before = parse(current);
			const gesture = drawGesture(rng, before);
			stats.gestures++;
			if (drawsMidScalar(before, gesture)) stats.midScalar[gesture.kind]++;
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
			const found = judgeGesture(gesture, { bytes: current, doc: before }, live, literal);
			// A dev guard that fired is a finding in its own right: the fuzzer is the caller that
			// provoked it. An `invariant:` fire is a contract that should never fire in EITHER arm, so
			// the twin excuses nothing there; for the rest, which arm provoked it is the usual question.
			if (liveWarns.length > 0) {
				const guarded = liveWarns.some((w) => w.tag.startsWith('invariant:'));
				found.push({
					oracle: 'dev-warn',
					category: guarded || liveWarns.length > literalWarns.length ? 'seam' : 'ambiguous',
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

/** Every violation one applied gesture reports; exported so a pin can replay one draw's verdict. */
export function judgeGesture(
	gesture: Gesture,
	origin: { bytes: string; doc: Document },
	live: Applied,
	literal: Applied
): Violation[] {
	const before = origin.bytes;
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
	if (liveShape && describeConvergence(literal.doc) === null) say('shape', 'seam', liveShape);
	const roundTrips = (bytes: string) => serialize(parse(bytes)) === bytes;
	if (!roundTrips(live.bytes) && roundTrips(literal.bytes)) {
		say('round-trip', 'seam', 'live bytes do not reparse to themselves');
	}
	// The one absolute claim in the set: half a scalar is bytes no UTF-8 boundary round-trips and no
	// inverse gesture restores, so no rebinding excuses it and the twin is no defense either. Held
	// against the input because only an ill-formed draw could hand a gesture one to keep, and
	// `invariants/corpus-coverage.test.ts` pins that the corpus draws none.
	if (!live.bytes.isWellFormed() && before.isWellFormed()) {
		const alsoLiteral = !literal.bytes.isWellFormed();
		say('well-formed', 'seam', `${alsoLiteral ? 'both arms' : 'live'} minted a lone surrogate`);
	}

	const start = origin.doc;
	const screenBefore = documentContentText(start);
	const liveScreen = documentContentText(live.doc);
	const literalScreen = documentContentText(literal.doc);
	const literalHolds = screenClaimHolds(gesture, screenBefore, literalScreen);

	if (!screenClaimHolds(gesture, screenBefore, liveScreen)) {
		say(
			'screen',
			literalHolds ? 'seam' : 'ambiguous',
			`screen went ${JSON.stringify(screenBefore)} → ${JSON.stringify(liveScreen)}`
		);
	}
	// One-sided, as it is in the seat's own net: whatever the parse rebinds, a rewrite may never put
	// more delimiters on screen than the document already showed PLUS the ones the gesture typed —
	// a `*` the user types is a glyph they asked for, and a seat that keeps it visible where the
	// literal insert buried it inside a URL is the honest answer. Stated against BEFORE rather than
	// against the twin, because the byte-literal edit can FORM a construct by accident and hide runs
	// live correctly kept. A press live SWALLOWED wrote nothing, so it makes no claim at all (§ 4.4).
	const shown = delimitersOnScreen(liveScreen) - delimitersOnScreen(typedRun(gesture));
	if (live.bytes !== before && shown > delimitersOnScreen(screenBefore)) {
		const alsoLiteral = delimitersOnScreen(literalScreen) >= shown;
		say(
			'delimiters',
			alsoLiteral ? 'ambiguous' : 'seam',
			`live shows ${JSON.stringify(liveScreen)} for ${JSON.stringify(screenBefore)}`
		);
	}

	if (!bytesConserved(gesture, before, live.bytes, literal.bytes)) {
		say('bytes', 'seam', 'live wrote bytes its gesture family may not write');
	}
	// Against the document the gesture STARTED from: § 4.1 forbids writing residue, and a twin that
	// happened to destroy a pre-existing run would otherwise read as live having minted one.
	const liveResidue = unpaintedResidue(live.doc);
	if (liveResidue > unpaintedResidue(start)) {
		// And against the twin: residue the byte-literal edit leaves too is nothing live minted.
		const minted = liveResidue > unpaintedResidue(literal.doc);
		say('residue', minted ? 'seam' : 'ambiguous', 'live minted a delimiter pair enclosing nothing');
	}
	return out;
}
