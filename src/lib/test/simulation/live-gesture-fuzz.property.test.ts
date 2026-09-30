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

// A seeded stream of typing and destructive gestures at hidden edges, each checked against what
// live-mode.md § 2 allows; the checks live in `live-gesture-fuzz.ts`, the budget and pins here.

// Miss-analysis: suites read a cut's bytes back only as inline text, so none saw it write a fence.

const FIXED_SEED = 606060;
const SEED = freshOrFixedSeed(FIXED_SEED);
/** About 1200 gestures, each applied twice and judged, matching the property suites' cost per
 *  run; the variables allow a deeper sweep, since this default runs inside `npm test`. */
const DOCS = Number(process.env.LIVE_FUZZ_DOCS ?? 100);
const STEPS = Number(process.env.LIVE_FUZZ_STEPS ?? 12);

/** Per applied gesture, so a deeper sweep doesn't trip it by running more. The headroom over the
 *  widest measured rate (0.24) allows for typed bytes that re-pair markdown in both runs. */
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
		// A check that refuses every candidate reads green on the checks above, so the cleanup
		// under a list marker has to be seen rewriting at all.
		expect(stats.rewroteUnderListMarker).toBeGreaterThan(0);
	});

	// These gestures take an offset a caller computed, so a draw inside a surrogate pair reaches
	// them. The counts are single digits, so the floor holds for the fixed seed only.
	it.runIf(SEED === FIXED_SEED)(
		'draws offsets inside a surrogate pair, at the doors that take a raw one',
		() => {
			expect(stats.midScalar.enter).toBeGreaterThan(0);
			expect(stats.midScalar['range-delete']).toBeGreaterThan(0);
			expect(stats.midScalar['cross-format-toggle']).toBeGreaterThan(0);
		}
	);

	/** An unwatched bucket takes in a new class silently, so it is held to a ceiling; a rise is a
	 *  signal to read the bucket, not automatically a defect. */
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

/** Shapes where live mode must write exactly what the byte-literal edit writes. */
describe('the shapes that used to need an exclusion', () => {
	// No placement keeps a nested pair sharing an asterisk run, so live declines and the byte
	// lands where the caret already was.
	it('#116: a byte against a shared asterisk run lands at the caret', async () => {
		const at = { kind: 'type' as const, offset: 18, char: 'a' };
		for (const affinity of ['outside', 'near'] as const) {
			const drawn = await liveAndLiteral('******foo***![](u)**\n', { ...at, affinity });
			expect(drawn.live, affinity).toBe(drawn.literal);
			expect(drawn.screen, affinity).toBe('*fooa');
		}
	});

	// A space just inside an opener kills the construct and paints both its runs, so the painter
	// rejects that candidate and the reading outside the run is written instead.
	it('#162: a space at an opener puts the caret outside the run it would break', async () => {
		const far = await liveAndLiteral('**bold** x\n', { offset: 0, char: ' ', affinity: 'far' });
		expect(far.live).toBe(' **bold** x\n');
		expect(far.live).toBe(far.literal);
		expect(far.screen).toBe(' bold x');
	});

	// No placement across a construct with no content keeps its delimiters hidden, so the caret's
	// own offset stands.
	it('#162: a byte across content-empty chrome surfaces nothing', async () => {
		const seated = await liveAndLiteral('**[](u)**&amp; z\n', {
			offset: 2,
			char: 'a',
			affinity: 'outside'
		});
		expect(seated.live).toBe(seated.literal);
		expect(seated.screen).toBe('a& z');
	});

	// A childless construct has no interior a cut can land in, so the cut moves to its nearer edge
	// and one half takes it whole: every byte kept, no delimiter on screen.
	it('#118: a split inside an autolink takes the whole autolink', async () => {
		const cut = await liveAndLiteral('<https://example.com> tail\n', { kind: 'enter', offset: 13 });
		expect(cut.live).toBe('<https://example.com>\n\n tail\n');
		expect(cut.literal).toBe('<https://exam\n\nple.com> tail\n');
		expect(cut.screen).toBe('https://example.com\n tail');
	});

	// The typed run goes into the cleanup's verification with the join, so the reading that would
	// show a pair around it is rejected and the byte-literal replace stands.
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

	// The cleaned body starts with a space the item's marker takes on reload: the cleanup reads it
	// back through the marker, where it still shows, and the tree takes the wider marker too.
	it('#163: a join in a list item drops the runs, and the tree reads as the reload does', async () => {
		const cut = await liveAndLiteral('- **a b** c\n', {
			kind: 'range-delete',
			offset: 0,
			endOffset: 5
		});
		expect(cut.live).toBe('-  c\n');
		expect(cut.literal).toBe('- ** c\n');
		expect(cut.shape).toBeNull();
	});

	// The rebalanced split's empty first half gets a blank line of its own, from the same fix-up as
	// any other gap between blocks.
	it('#164: a split with an empty first half converges', async () => {
		const cut = await liveAndLiteral('## \n**a**b\n', { kind: 'enter', leaf: 1, offset: 2 });
		expect(cut.live).toBe('## \n\n**a**b\n');
		expect(cut.shape).toBeNull();
		expect(cut.literalShape).toBeNull();
	});

	// A tilde pairs only as a double run, so the empty-pair collapse has no partner to drop between
	// two single tildes, in either mode.
	it('#462: a space between two tildes keeps both', async () => {
		const typed = await liveAndLiteral('*foo~![](u)*~~b &https://example.com \n', {
			offset: 13,
			char: ' ',
			affinity: 'far'
		});
		expect(typed.live).toBe('*foo~![](u)*~ ~b &https://example.com \n');
		expect(typed.live).toBe(typed.literal);
	});

	// A join whose bytes reparse to two blocks doesn't fit the one child slot, so both runs refuse
	// it, silently, since a refusal is an ordinary editing outcome (G1.35).
	it('#166: a join whose bytes reparse to two blocks is refused, not truncated', async () => {
		const merged = await liveAndLiteral('## \n(u\n)\n', { kind: 'delete', leaf: 0, offset: 0 });
		expect(merged.live).toBe('## \n(u\n)\n');
		expect(merged.live).toBe(merged.literal);
		expect(merged.shape).toBeNull();
		expect(takeDevWarns()).toEqual([]);
	});
});

/** Markers standing over no content are bytes the user saw, so neither split nor join may move
 *  them; a sweep check would misfire where live rightly removes the literal edit's residue. */
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

	// Both runs leave one pair enclosing nothing, so the residue belongs to the byte-literal edit.
	// Miss-analysis: every residue pin started with none, so no case had both runs leave one.
	it('a residue the byte-literal counterpart leaves too is not live creating one', async () => {
		const typed = await liveAndLiteral('**[](u)**\n', { offset: 9, char: 'a', affinity: 'near' });
		expect(typed.live).toBe('**[](u)a**\n');
		expect(typed.literal).toBe('**[](u)**a\n');
		expect(typed.seams().map((v) => v.oracle)).toEqual([]);
	});
});
