// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	registerLiveJoinSeamCleaner,
	registerLiveSplitRebalancer,
	__resetLiveJoinSeamCleanerForTests,
	__resetLiveSplitRebalancerForTests
} from '$lib/schema/inline-construct-policy';
import { cleanLiveJoinSeam } from '$lib/components/blocks/text/live-join-seam';
import { rebalanceLiveSplit } from '$lib/components/blocks/text/live-split-rebalance';
import { freshOrFixedSeed } from '$lib/test/invariants/arbitraries';
import { fuzzLiveGestures, judgeGesture, type FuzzStats } from './live-gesture-fuzz';
import { parse } from '$lib/core/parser';
import { applyGesture, resetSurfaces, type Gesture } from './live-gesture-seams';
import { documentContentText } from './live-screen-reading';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { takeDevWarns } from '$lib/test/support/warn-gate';
import '$lib/schema/built-in-descriptors';
import '$lib/components/built-in-blocks';

// The edge cases live-mode.md § 4 catalogs are a space to search, and the simulation drives
// scripted flows through it. This searches between them: a seeded stream of typing and destructive
// gestures at hidden-edge positions, every one checked against what § 2 allows. The checks and the
// violation categories live in `live-gesture-fuzz.ts`; this file owns the budget and the pins.

// Miss-analysis for the defect this fuzzer landed with (the cut that wrote a fence, pinned in
// `blocks/text/construct-edge-delete.test.ts`): every suite over that branch fed it a fixture and
// read its bytes back as inline text, so none could see a candidate whose bytes re-read as a
// different block, and no generator drew a document holding a childless construct between two
// literal runs.

const FIXED_SEED = 606060;
const SEED = freshOrFixedSeed(FIXED_SEED);
/** Matches the property suites' cost per run: about 1200 gestures, each applied twice and judged.
 *  A deeper sweep is an option through these variables rather than a bigger default, since this
 *  one runs inside `npm test`. */
const DOCS = Number(process.env.LIVE_FUZZ_DOCS ?? 100);
const STEPS = Number(process.env.LIVE_FUZZ_STEPS ?? 12);

/**
 * The ceiling on the unnamed bucket, measured per applied gesture: an absolute count would only say
 * how big the sweep was, and the deeper sweep above would trip it just by running more. The
 * headroom over the widest rate three seeds measure (0.24) is there because a typed byte that
 * creates a construct re-pairs more of markdown in both runs, which is coverage arriving rather
 * than live drifting.
 */
const AMBIGUOUS_RATE_CEILING = 0.3;

let stats: FuzzStats;

beforeAll(async () => {
	registerLiveSplitRebalancer(rebalanceLiveSplit);
	registerLiveJoinSeamCleaner(cleanLiveJoinSeam);
	stats = await fuzzLiveGestures({ seed: SEED, docs: DOCS, steps: STEPS });
});
afterAll(() => {
	__resetLiveSplitRebalancerForTests();
	__resetLiveJoinSeamCleanerForTests();
});

describe('live-mode gestures at hidden edges', () => {
	it('leaves no divergence the byte-literal counterpart does not already have', () => {
		const seams = stats.violations.filter((v) => v.category === 'seam');
		expect(seams.map((v) => v.report).join('\n\n'), `seed ${SEED}`).toBe('');
	});

	// A sweep whose gestures never reach a live rewrite proves nothing about one, and each counter
	// names a different piece of code: the caret-edge handlers, the split, and the join cleanup.
	it('reaches every join it claims to search', () => {
		expect(stats.applied).toBeGreaterThan(DOCS * 5);
		expect(stats.claimed).toBeGreaterThan(20);
		expect(stats.rewrote.type).toBeGreaterThan(5);
		expect(stats.rewrote.enter).toBeGreaterThan(5);
		expect(stats.rewrote['range-delete']).toBeGreaterThan(5);
		expect(stats.rewrote.backspace + stats.rewrote.delete).toBeGreaterThan(10);
		// These two cover the format toggle, and the beforeinput handler only a chorded delete
		// reaches. Both count draws where live diverged from the byte-literal edit.
		expect(stats.rewrote['format-toggle']).toBeGreaterThan(5);
		expect(stats.rewrote['word-delete']).toBeGreaterThan(5);
		// The toggle again, spread over two leaves: the per-block spans a range decomposes into
		// are verified one at a time, so a range can rewrite where a single block would not.
		expect(stats.rewrote['cross-format-toggle']).toBeGreaterThan(5);
	});

	// The three gestures whose offset a caller computes rather than the browser reporting it: one
	// drawn inside a surrogate pair reaches that code, and a silent well-formedness check means the
	// snap held. The counts are single digits at the default budget, so this floor holds for the
	// fixed seed only: a fresh seed is there to turn up new finds, and failing on a thin draw would
	// bury them in noise.
	it.runIf(SEED === FIXED_SEED)(
		'draws offsets inside a surrogate pair, at the doors that take a raw one',
		() => {
			expect(stats.midScalar.enter).toBeGreaterThan(0);
			expect(stats.midScalar['range-delete']).toBeGreaterThan(0);
			expect(stats.midScalar['cross-format-toggle']).toBeGreaterThan(0);
		}
	);

	/**
	 * The unnamed bucket, held to a ceiling rather than left unbounded. Every entry is a divergence
	 * the byte-literal run has too, so none is live's to answer, but an unwatched bucket takes in a
	 * new class silently: that is how #166, a block dropped in every mode, sat here unnamed. A rise
	 * is a signal to read the bucket, not automatically a defect.
	 */
	it('keeps the unnamed bucket inside its ceiling', () => {
		const ambiguous = stats.violations.filter((v) => v.category === 'ambiguous');
		const detail = [`${ambiguous.length} of ${stats.applied} applied`]
			.concat(ambiguous.slice(0, 3).map((v) => v.report))
			.join('\n\n');
		expect(ambiguous.length / stats.applied, detail).toBeLessThan(AMBIGUOUS_RATE_CEILING);
	});
});

// ── The pins ─────────────────────────────────────────────────────────────────

const gesture = (over: Partial<Gesture>): Gesture => ({
	kind: 'type',
	leaf: 0,
	offset: 0,
	endLeaf: 0,
	endOffset: 0,
	char: 'a',
	affinity: null,
	mark: 0,
	...over
});

async function liveAndLiteral(source: string, over: Partial<Gesture>) {
	const drawn = gesture(over);
	resetSurfaces();
	const live = await applyGesture(source, drawn, 'live');
	resetSurfaces();
	const literal = await applyGesture(source, drawn, undefined);
	resetSurfaces();
	return {
		live: live?.bytes,
		literal: literal?.bytes,
		screen: live ? documentContentText(live.doc) : null,
		shape: live ? describeConvergence(live.doc) : null,
		literalShape: literal ? describeConvergence(literal.doc) : null,
		/** The sweep's own answer for this draw, computed on demand, so a pin can read a check. */
		seams: () =>
			live && literal
				? judgeGesture(drawn, { bytes: source, doc: parse(source) }, live, literal).filter(
						(v) => v.category === 'seam'
					)
				: []
	};
}

/**
 * Regression pins for the shapes the sweep used to excuse: each was a divergence live mode alone
 * produced, with an issue number, and each now writes what the byte-literal edit writes.
 */
describe('the shapes that used to need an exclusion', () => {
	// #116: a run of three or more asterisks shared between a nested pair. No placement keeps the
	// pairing, so live declines and the byte lands where the caret already was.
	it('#116: a byte against a shared asterisk run lands at the caret', async () => {
		const at = { kind: 'type' as const, offset: 18, char: 'a' };
		for (const affinity of ['outside', 'near'] as const) {
			const drawn = await liveAndLiteral('******foo***![](u)**\n', { ...at, affinity });
			expect(drawn.live, affinity).toBe(drawn.literal);
			expect(drawn.screen, affinity).toBe('*fooa');
		}
	});

	// #162: a space placed just inside an opener kills the construct and paints both its runs, so
	// the painter rejects that candidate and the reading outside the run is written instead.
	it('#162: a space at an opener puts the caret outside the run it would break', async () => {
		const far = await liveAndLiteral('**bold** x\n', { offset: 0, char: ' ', affinity: 'far' });
		expect(far.live).toBe(' **bold** x\n');
		expect(far.live).toBe(far.literal);
		expect(far.screen).toBe(' bold x');
	});

	// #162, second shape: no placement across a construct with no content keeps its delimiters
	// hidden, so the caret's own offset stands.
	it('#162: a byte across content-empty chrome surfaces nothing', async () => {
		const seated = await liveAndLiteral('**[](u)**&amp; z\n', {
			offset: 2,
			char: 'a',
			affinity: 'outside'
		});
		expect(seated.live).toBe(seated.literal);
		expect(seated.screen).toBe('a& z');
	});

	// #118: a childless construct has no interior a cut can land in, so the cut moves to its nearer
	// edge and one half takes it whole: every byte kept, no delimiter on screen.
	it('#118: a split inside an autolink takes the whole autolink', async () => {
		const cut = await liveAndLiteral('<https://example.com> tail\n', { kind: 'enter', offset: 13 });
		expect(cut.live).toBe('<https://example.com>\n\n tail\n');
		expect(cut.literal).toBe('<https://exam\n\nple.com> tail\n');
		expect(cut.screen).toBe('https://example.com\n tail');
	});

	// #165: the typed run goes into the cleanup's own verification with the join, so the reading
	// that would show a pair around it is rejected and the byte-literal replace stands.
	it('#165: the selection replace verifies the bytes it writes', async () => {
		const typed = await liveAndLiteral('lorem*汉[](u)*`a`\n', {
			kind: 'type-over',
			offset: 14,
			endOffset: 16,
			char: 'a'
		});
		expect(typed.live).toBe(typed.literal);
		expect(typed.screen).toBe('lorem汉`a');
	});

	// #163: the cleaned body would start with a space the item's marker swallows on reload, so the
	// cleanup reads its candidate back through the marker and turns it down.
	it('#163: a join in a list item keeps the marker the tree holds', async () => {
		const cut = await liveAndLiteral('- **a b** c\n', {
			kind: 'range-delete',
			offset: 0,
			endOffset: 5
		});
		expect(cut.live).toBe('- ** c\n');
		expect(cut.live).toBe(cut.literal);
		expect(cut.shape).toBeNull();
	});

	// #164: the rebalanced split's empty first half must get a blank line of its own, handed to it
	// by the same fix-up as any other gap between blocks (#183).
	it('#164: a split with an empty first half converges', async () => {
		const cut = await liveAndLiteral('## \n**a**b\n', { kind: 'enter', leaf: 1, offset: 2 });
		expect(cut.live).toBe('## \n\n**a**b\n');
		expect(cut.shape).toBeNull();
		expect(cut.literalShape).toBeNull();
	});

	// #462, seed 3069811188 (doc 4, step 3): a tilde pairs only as a double run, so the empty-pair
	// collapse has no partner of its own to drop between two single tildes, in either mode.
	it('#462: a space between two tildes keeps both', async () => {
		const typed = await liveAndLiteral('*foo~![](u)*~~b &https://example.com \n', {
			offset: 13,
			char: ' ',
			affinity: 'far'
		});
		expect(typed.live).toBe('*foo~![](u)*~ ~b &https://example.com \n');
		expect(typed.live).toBe(typed.literal);
	});

	// #166, the one class the sweep found that shows in every mode: a join whose bytes reparse to
	// two blocks does not fit the single child slot the write installs into, so both runs refuse it
	// and the pair stands. Silently, in both: the refusal is an ordinary editing outcome (G1.35),
	// so the warning is about installing such bytes, never about meeting them.
	it('#166: a join whose bytes reparse to two blocks is refused, not truncated', async () => {
		const merged = await liveAndLiteral('## \n(u\n)\n', { kind: 'delete', leaf: 0, offset: 0 });
		expect(merged.live).toBe('## \n(u\n)\n');
		expect(merged.live).toBe(merged.literal);
		expect(merged.shape).toBeNull();
		expect(takeDevWarns()).toEqual([]);
	});
});

/**
 * Pinned here rather than checked in the sweep: markers standing over no content are bytes the user
 * saw, so neither the split nor the join may move or drop them. A sweep check for it would fire on
 * live rightly removing residue the byte-literal edit left behind.
 */
describe('painted chrome survives both cut joins', () => {
	it('a split inside painted chrome stays byte-literal', async () => {
		const cut = await liveAndLiteral('**[](u)**\n', { kind: 'enter', offset: 4 });
		expect(cut.live).toBe('**[]\n\n(u)**\n');
		expect(cut.live).toBe(cut.literal);
	});

	it('a join beside painted chrome keeps every byte of it', async () => {
		const cut = await liveAndLiteral('**[](u)**\n\n**[](u)**\n', {
			kind: 'range-delete',
			leaf: 0,
			offset: 9,
			endLeaf: 1,
			endOffset: 0
		});
		expect(cut.live).toBe('**[](u)****[](u)**\n');
		expect(cut.live).toBe(cut.literal);
	});

	// The draw the residue check reported as live's alone (fresh seed 4032657474, doc 13 step 0):
	// both runs leave one pair enclosing nothing, so the increase belongs to the byte-literal edit.
	// Miss-analysis: every residue pin started from a source holding none, so no case ever handed
	// the check a draw where both runs leave one.
	it('a residue the byte-literal counterpart leaves too is not live creating one', async () => {
		const typed = await liveAndLiteral('**[](u)**\n', { offset: 9, char: 'a', affinity: 'near' });
		expect(typed.live).toBe('**[](u)a**\n');
		expect(typed.literal).toBe('**[](u)**a\n');
		expect(typed.seams().map((v) => v.oracle)).toEqual([]);
	});
});
