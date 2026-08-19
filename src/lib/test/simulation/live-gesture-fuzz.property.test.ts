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
import { fuzzLiveGestures, type FuzzStats } from './live-gesture-fuzz';
import { applyGesture, resetSurfaces, type Gesture } from './live-gesture-seams';
import { documentContentText } from './live-screen-reading';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { takeDevWarns } from '$lib/test/support/warn-gate';
import '$lib/schema/built-in-descriptors';
import '$lib/components/built-in-blocks';

// The § 4 catalog's edge cases are a searchable space, and the simulation drives scripted flows
// through it. This searches between them: a seeded stream of typing and destructive gestures at
// hidden-edge positions, every one checked against § 2's license. The oracles and the violation
// categories live in `live-gesture-fuzz.ts`; this file owns the budget and the pins.

// Miss-analysis for the defect this net landed with (the fence-minting cut, pinned in
// `blocks/text/construct-edge-delete.test.ts`): every suite over that arm fed it a fixture and read
// its bytes back as inline text, so none could see a candidate whose bytes re-read as a different
// BLOCK — and no generator drew a document holding a childless construct between two literal runs.

const SEED = freshOrFixedSeed(606060);
/** Matches the property suites' per-run cost: ~1200 gestures, each applied twice and judged. The
 *  deep lane is a knob rather than a bigger default, since the sweep runs inside `npm test`. */
const DOCS = Number(process.env.LIVE_FUZZ_DOCS ?? 100);
const STEPS = Number(process.env.LIVE_FUZZ_STEPS ?? 12);

/**
 * The unnamed bucket's ceiling, PER APPLIED GESTURE — an absolute count measures how big the
 * sweep was, so the deep lane above reds on nothing but its own budget. Headroom over the widest
 * rate three seeds measure (0.24): a typed byte that mints a construct rebinds more of markdown
 * in BOTH arms, which is coverage arriving rather than live drifting.
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
	it('leaves no divergence the byte-literal twin does not already have', () => {
		const seams = stats.violations.filter((v) => v.category === 'seam');
		expect(seams.map((v) => v.report).join('\n\n'), `seed ${SEED}`).toBe('');
	});

	// Non-vacuity: a sweep whose gestures never reach a live rewrite proves nothing about one, and
	// each counter names a different seam — the caret-edge arms, the split, and the join cleaner.
	it('reaches every seam it claims to search', () => {
		expect(stats.applied).toBeGreaterThan(DOCS * 5);
		expect(stats.claimed).toBeGreaterThan(20);
		expect(stats.rewrote.type).toBeGreaterThan(5);
		expect(stats.rewrote.enter).toBeGreaterThan(5);
		expect(stats.rewrote['range-delete']).toBeGreaterThan(5);
		expect(stats.rewrote.backspace + stats.rewrote.delete).toBeGreaterThan(10);
		// The two newest entrances: the toggle seam, and the beforeinput arm a chorded delete is the
		// only gesture that reaches. Both count draws where live diverged from the byte-literal twin.
		expect(stats.rewrote['format-toggle']).toBeGreaterThan(5);
		expect(stats.rewrote['word-delete']).toBeGreaterThan(5);
	});

	// The two gestures whose offset a CALLER computes rather than the engine reporting it: a
	// mid-scalar one reaches the seam, and a silent well-formedness oracle means its snap held.
	// Single digits at the default budget, so a zero is a thin draw before it is a defect.
	it('draws offsets inside a surrogate pair, at the doors that take a raw one', () => {
		expect(stats.midScalar.enter).toBeGreaterThan(0);
		expect(stats.midScalar['range-delete']).toBeGreaterThan(0);
	});

	/**
	 * The unnamed bucket, held to a ceiling rather than left unbounded. Every entry is a divergence
	 * the byte-literal twin has too, so none is live's to answer — but an unwatched bucket absorbs
	 * a new class silently, which is how #166 (a mode-independent block drop) sat in it unnamed.
	 * A rise here is a signal to read the bucket, not automatically a defect.
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
	resetSurfaces();
	const live = await applyGesture(source, gesture(over), 'live');
	resetSurfaces();
	const literal = await applyGesture(source, gesture(over), undefined);
	resetSurfaces();
	return {
		live: live?.bytes,
		literal: literal?.bytes,
		screen: live ? documentContentText(live.doc) : null,
		shape: live ? describeConvergence(live.doc) : null,
		literalShape: literal ? describeConvergence(literal.doc) : null
	};
}

/**
 * The shapes the sweep once excused, kept as the fixes' regression pins: each was a live-only
 * divergence with a ledger number, and each now writes what the byte-literal twin writes.
 */
describe('the shapes that used to need an exclusion', () => {
	// #116: a run of three or more asterisks shared between a nested pair. No seat keeps the
	// pairing, so the seat declines and the byte lands where the caret already was.
	it('#116 — a byte against a shared asterisk run lands at the caret', async () => {
		const at = { kind: 'type' as const, offset: 18, char: 'a' };
		for (const affinity of ['outside', 'near'] as const) {
			const drawn = await liveAndLiteral('******foo***![](u)**\n', { ...at, affinity });
			expect(drawn.live, affinity).toBe(drawn.literal);
			expect(drawn.screen, affinity).toBe('*fooa');
		}
	});

	// #162: a space seated just inside an opener kills the construct and paints both its runs, so
	// the painter rejects that candidate and the outside reading is written instead.
	it('#162 — a space at an opener seats outside the run it would break', async () => {
		const far = await liveAndLiteral('**bold** x\n', { offset: 0, char: ' ', affinity: 'far' });
		expect(far.live).toBe(' **bold** x\n');
		expect(far.live).toBe(far.literal);
		expect(far.screen).toBe(' bold x');
	});

	// #162, second shape: no seat across a content-empty construct keeps its delimiters hidden, so
	// the caret's own offset stands.
	it('#162 — a byte across content-empty chrome surfaces nothing', async () => {
		const seated = await liveAndLiteral('**[](u)**&amp; z\n', {
			offset: 2,
			char: 'a',
			affinity: 'outside'
		});
		expect(seated.live).toBe(seated.literal);
		expect(seated.screen).toBe('a& z');
	});

	// #118, settled: a childless construct has no interior a cut can land in, so the cut moves to
	// its nearer edge and one half takes it whole — every byte kept, no delimiter on screen.
	it('#118 — a split inside an autolink takes the whole autolink', async () => {
		const cut = await liveAndLiteral('<https://example.com> tail\n', { kind: 'enter', offset: 13 });
		expect(cut.live).toBe('<https://example.com>\n\n tail\n');
		expect(cut.literal).toBe('<https://exam\n\nple.com> tail\n');
		expect(cut.screen).toBe('https://example.com\n tail');
	});

	// #165: the typed run rides the seam into the cleanup's own verification, so the reading that
	// would surface a pair around it is rejected and the literal replace stands.
	it('#165 — the selection replace verifies the bytes it writes', async () => {
		const typed = await liveAndLiteral('lorem*汉[](u)*`a`\n', {
			kind: 'type-over',
			offset: 14,
			endOffset: 16,
			char: 'a'
		});
		expect(typed.live).toBe(typed.literal);
		expect(typed.screen).toBe('lorem汉`a');
	});

	// #163: the cleaned body would start with a space the item's marker absorbs on reload, so the
	// seam reads its candidate back through the marker and declines it.
	it('#163 — a join in a list item keeps the marker the tree holds', async () => {
		const cut = await liveAndLiteral('- **a b** c\n', {
			kind: 'range-delete',
			offset: 0,
			endOffset: 5
		});
		expect(cut.live).toBe('- ** c\n');
		expect(cut.live).toBe(cut.literal);
		expect(cut.shape).toBeNull();
	});

	// #164's shape, settled by the splice settle's seam ask (GH #183): the rebalanced split's empty
	// first half owes a blank line of its own, handed to it like any other window.
	it('#164 — a split with an empty first half converges', async () => {
		const cut = await liveAndLiteral('## \n**a**b\n', { kind: 'enter', leaf: 1, offset: 2 });
		expect(cut.live).toBe('## \n\n**a**b\n');
		expect(cut.shape).toBeNull();
		expect(cut.literalShape).toBeNull();
	});

	// #166, the one MODE-INDEPENDENT class the sweep surfaced: a join whose bytes reparse to two
	// blocks has no home in the one slot the door installs, so both doors refuse it and the pair
	// stands where it did. Silently, in both arms — the refusal is an ordinary editing outcome
	// (G1.35), so the seam warns about installing such bytes, never about meeting them.
	it('#166 — a join whose bytes reparse to two blocks is refused, not truncated', async () => {
		const merged = await liveAndLiteral('## \n(u\n)\n', { kind: 'delete', leaf: 0, offset: 0 });
		expect(merged.live).toBe('## \n(u\n)\n');
		expect(merged.live).toBe(merged.literal);
		expect(merged.shape).toBeNull();
		expect(takeDevWarns()).toEqual([]);
	});
});

/**
 * The class this batch fixed at both cut seams, held as a pin rather than as a sweep oracle: chrome
 * standing over no content is bytes the reader saw, so neither seam may move or drop them. A sweep
 * arm for it fires on live's own LEGITIMATE removal of residue the literal edit left behind.
 */
describe('painted chrome survives both cut seams', () => {
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
});
