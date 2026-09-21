/**
 * The live-mode gesture fuzzer: a seeded stream of typing and destructive gestures at hidden-edge
 * positions, each checked against what live-mode.md § 2 allows. Every check runs per gesture and,
 * where the byte-literal edit already differs, compares live against a second run of the same
 * gesture with live mode off.
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

/** The characters that can delimit the drawn construct: the delimiter bytes in its policy row, plus
 *  `_`, the other emphasis spelling, which no policy row names. Stripping them has to cover
 *  whichever of the two the document's author wrote. */
function markAlphabet(entry: ReturnType<typeof drawnMark>): Set<string> {
	const chars = new Set(entry.mark.markerBytes);
	if (chars.has('*')) chars.add('_');
	return chars;
}

// ── What a run reports ───────────────────────────────────────────────────────

/**
 * `seam` means live mode diverged where the same gesture with live mode off held: a defect, and
 * what the sweep fails on. Well-formedness is the one check that counts against either run.
 * `ambiguous` is both runs failing the same check: markdown re-pairing its own delimiters, or the
 * fallback to the byte-literal edit that live-mode.md § 4.4 allows.
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

/** Bytes that start a block: a pipe opens a table row, `#` a heading, `>` a quote, `:` a directive
 *  fence. No registry lists them, unlike the inline delimiters {@link typedVocabulary} reads. */
const BLOCK_MINTING_CHARS = ['|', '#', '>', ':'];

/** Read from the mark table for the same reason the `mark` draw is: a delimiter registered later is
 *  typed from then on, rather than frozen into whatever was registered when this was written. */
function typedVocabulary(): string[] {
	const heads = new Set(listInlineMarks().map(({ mark }) => mark.markerBytes[0]));
	return [...INERT_CHARS, ...BLOCK_MINTING_CHARS, ...heads];
}

const AFFINITIES: (EdgeAffinity | null)[] = ['near', 'far', 'outside', null];

/** Both toggle gestures answer to the same two checks: one block's span, or a range of blocks. */
const isFormatToggle = (kind: GestureKind): boolean =>
	kind === 'format-toggle' || kind === 'cross-format-toggle';

/** Biased toward hidden edges, because an even draw meets a zero-width run only by accident. The
 *  same goes for the inside of a surrogate pair, two units wide in a mostly ASCII document. */
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
		// Read from the table, so a mark registered later is drawn from then on rather than
		// wrapping back into the four that were there when this was written.
		mark: rng.int(0, listInlineMarks().length)
	};
}

// ── The checks ───────────────────────────────────────────────────────────────

/**
 * The screen shows what the gesture claimed: an insertion adds exactly what was typed, a split adds
 * exactly one line break, and a destructive keypress may only take glyphs away. Read as the content
 * behind every marker family, the before/after comparison live-mode.md § 2 names: a block's markers
 * stop painting the moment content arrives, and a screen-side reading would call that bytes lost.
 */
function screenClaimHolds(gesture: Gesture, before: string, after: string): boolean {
	if (gesture.kind === 'type') return insertsSomewhere(before, after, gesture.char);
	// A two-step gesture has no single-glyph change to claim: its first write adds a sibling before
	// the drawn one lands. The shape, round-trip and dev-warning checks judge it instead.
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
 *  way the screen paints them: inserting into trailing whitespace changes no glyph at all. */
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

/** Delimiter bytes a construct can paint. `_` stays out: underscore emphasis only pairs at a word
 *  boundary, so a byte against `__x__` kills the pair from either side whatever live mode does. */
const delimitersOnScreen = (text: string): number => (text.match(/[*~`<>[\]]/g) ?? []).length;

/** What the gesture asked to appear on screen, which the delimiter check has to allow it. */
const typedRun = (gesture: Gesture): string =>
	gesture.kind === 'type' || gesture.kind === 'type-over' ? gesture.char : '';

/**
 * What live-mode.md § 2 allows over bytes, per gesture family. Typing loses nothing; a split keeps
 * every byte but a line ending; a destructive keypress only removes. The two range gestures cut the
 * same span in both runs, so there the run with live mode off is the upper bound. A caret-edge
 * keypress takes a different character from the browser's on purpose (§ 4.4), so it bounds nothing.
 */
function bytesConserved(gesture: Gesture, before: string, live: string, literal: string): boolean {
	if (gesture.kind === 'type') return isSubsequence(inked(before), inked(live));
	if (gesture.kind === 'enter') return keepsEveryByte(before, live);
	if (gesture.kind === 'backspace' || gesture.kind === 'delete') {
		return isSubsequence(inked(live), inked(before));
	}
	// A toggle splits and absorbs runs: one press may strip, move and add the toggled construct's
	// own delimiters at once, so the direction of the change says nothing. The check is exact
	// instead: outside that construct's delimiter characters, live matches before byte for byte.
	if (isFormatToggle(gesture.kind)) {
		const alphabet = markAlphabet(drawnMark(gesture));
		const scrub = (bytes: string) => [...inked(bytes)].filter((ch) => !alphabet.has(ch)).join('');
		return scrub(live) === scrub(before);
	}
	// A branch that owns a keypress but has no sound rewrite writes nothing (live-mode.md § 4.4).
	return live === before || isSubsequence(inked(live), inked(literal));
}

/**
 * Whitespace out. A structural edit adds and drops line endings by design (a split adds one, an
 * emptied block gains a separator) and a join reorders the whitespace where the two halves meet,
 * both of which an ordered subsequence check would read as bytes lost. The cost is stated rather
 * than hidden: no check reading bytes this way can see a dropped mid-line space. Only `enter` still
 * can, through `keepsEveryByte`, and #106 declares trailing whitespace the only drop live may make.
 */
const inked = (bytes: string): string => bytes.replace(/\s+/g, '');

// ── The run ──────────────────────────────────────────────────────────────────

/** Read from the weight table, so a gesture added there is counted as soon as it is drawn. */
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
			// A dev-mode check that fired is a finding in its own right: the fuzzer is what provoked it.
			// An `invariant:` warning should never fire in either run, so the run with live mode off
			// excuses nothing there; for the rest, which run provoked it is the usual question.
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

/** Every violation one applied gesture reports; exported so a pin can replay one draw's result. */
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
	// The one absolute check here: half a character is bytes no UTF-8 boundary round-trips and no
	// reverse gesture restores, so nothing excuses it and the run with live mode off is no defense.
	// Held against the input because only an ill-formed draw could hand a gesture one to keep, and
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
	// One-sided, the way the edge-placement tests state it: whatever the parse re-pairs, a rewrite
	// may never show more delimiters than the document already showed plus the ones the gesture
	// typed. A `*` the user types is a glyph they asked for, and keeping it visible where the
	// byte-literal insert buried it in a URL is the honest answer. Measured against the document
	// before the gesture, not the other run, since the byte-literal edit can form a construct by
	// accident and hide runs live kept. Where live wrote nothing, there is no claim (§ 4.4).
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
	// Against the document the gesture started from: live-mode.md § 4.1 forbids writing residue (a
	// delimiter pair enclosing nothing), and a run with live mode off that happened to destroy one
	// already there would otherwise read as live having written one.
	const liveResidue = unpaintedResidue(live.doc);
	if (liveResidue > unpaintedResidue(start)) {
		// And against the other run: residue the byte-literal edit leaves too is not live's doing.
		const minted = liveResidue > unpaintedResidue(literal.doc);
		say('residue', minted ? 'seam' : 'ambiguous', 'live minted a delimiter pair enclosing nothing');
	}
	return out;
}
