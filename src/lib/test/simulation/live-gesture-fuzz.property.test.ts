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
import '$lib/schema/built-in-descriptors';
import '$lib/components/built-in-blocks';

// The § 4 catalog's edge cases are a searchable space, and the simulation drives scripted flows
// through it. This searches between them: a seeded stream of typing and destructive gestures at
// hidden-edge positions, every one checked against § 2's license. The oracles and the three
// violation categories live in `live-gesture-fuzz.ts`; this file owns the budget and the pins.

// Miss-analysis for the defect this net landed with (the fence-minting cut, pinned in
// `blocks/text/construct-edge-delete.test.ts`): every suite over that arm fed it a fixture and read
// its bytes back as inline text, so none could see a candidate whose bytes re-read as a different
// BLOCK — and no generator drew a document holding a childless construct between two literal runs.

const SEED = freshOrFixedSeed(606060);
/** Matches the property suites' per-run cost: ~1200 gestures, each applied twice and judged. The
 *  deep lane is a knob rather than a bigger default, since the sweep runs inside `npm test`. */
const DOCS = Number(process.env.LIVE_FUZZ_DOCS ?? 100);
const STEPS = Number(process.env.LIVE_FUZZ_STEPS ?? 12);

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
 * The open issues the sweep excuses, each pinned to the shape that earns the exclusion. A pin
 * asserts the CURRENT bytes, so closing the issue reds it and the exclusion has to go with it.
 */
describe('the shapes the sweep excuses, and the issues that own them', () => {
	// #116: a run of three or more asterisks shared between a nested pair. Either seat rebinds the
	// pairing, and the near side happens to be the one that keeps this screen.
	it('#116 — a byte seated against a shared asterisk run rebinds the pairing', async () => {
		const at = { kind: 'type' as const, offset: 18, char: 'a' };
		const outside = await liveAndLiteral('******foo***![](u)**\n', { ...at, affinity: 'outside' });
		expect(outside.live).toBe('******foo***![](u)**a\n');
		expect(outside.screen).toBe('***foo**a');
		const near = await liveAndLiteral('******foo***![](u)**\n', { ...at, affinity: 'near' });
		expect(near.screen).toBe('*fooa');
	});

	// #162: the seat writes without verifying its candidate through the render path, so a space
	// seated just inside an opener kills the construct and paints both its runs.
	it('#162 — a space seated inside an opener paints the run it broke', async () => {
		const far = await liveAndLiteral('**bold** x\n', { offset: 0, char: ' ', affinity: 'far' });
		expect(far.live).toBe('** bold** x\n');
		expect(far.screen).toBe('** bold** x');
		expect(far.literal).toBe(' **bold** x\n');
	});

	// #162, second shape: a byte seated across a content-empty construct surfaces its delimiters.
	it('#162 — a byte seated across content-empty chrome surfaces it', async () => {
		const seated = await liveAndLiteral('**[](u)**&amp; z\n', {
			offset: 2,
			char: 'a',
			affinity: 'outside'
		});
		expect(seated.live).toBe('a**[](u)**&amp; z\n');
		expect(seated.screen).toBe('a****& z');
	});

	// #118: a cut through a childless construct writes its delimiters onto the screen. The painting
	// side gate (`paintsOnlyChrome`) does NOT reach it — an autolink HAS content, so its chrome
	// hides — and § 4.4 declares the byte-literal fallback rather than trading the round-trip.
	it('#118 — a split inside an autolink stays byte-literal, brackets and all', async () => {
		const cut = await liveAndLiteral('<https://example.com> tail\n', { kind: 'enter', offset: 13 });
		expect(cut.live).toBe('<https://exam\n\nple.com> tail\n');
		expect(cut.live).toBe(cut.literal);
		expect(cut.screen).toBe('<https://exam\nple.com> tail');
	});

	// #136: the join cleaner's splice abuts two runs into a shared one the empty-pair net reads as
	// residue. The cut unwraps the link between the two blocks' asterisk runs.
	it('#136 — the join cleaner splices two asterisk runs into a shared one', async () => {
		const cut = await liveAndLiteral('[**bold**](url)***foo***foo\n', {
			kind: 'range-delete',
			offset: 0,
			endOffset: 1
		});
		expect(cut.live).toBe('**bold*****foo***foo\n');
		expect(cut.live).not.toBe(cut.literal);
	});

	// #163: the cleaned join leaves the item's body starting with a space, and the reload folds it
	// into the marker — the live tree and the reload disagree about where the marker ends.
	it('#163 — a cleaned join in a list item moves the marker on reload', async () => {
		const cut = await liveAndLiteral('- **a b** c\n', {
			kind: 'range-delete',
			offset: 0,
			endOffset: 5
		});
		expect(cut.live).toBe('-  c\n');
		expect(cut.shape).toBe('[0,0] listItem.marker: live "- " != reparsed "-  "');
		expect(cut.literalShape).toBeNull();
	});

	// #164: the rebalanced split's first half comes out empty, and with no blank line of its own
	// above it the block it writes reloads as the heading's separator.
	it('#164 — a split with an empty first half loses a block on reload', async () => {
		const cut = await liveAndLiteral('## \n**a**b\n', { kind: 'enter', leaf: 1, offset: 2 });
		expect(cut.live).toBe('## \n\n**a**b\n');
		expect(cut.shape).toBe('[] live has 3 children, reparsed has 2');
		expect(cut.literalShape).toBeNull();
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
