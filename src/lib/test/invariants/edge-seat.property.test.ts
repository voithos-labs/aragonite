// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseInline } from '../../core/inline';
import { renderInlineNodes } from '../../core/inline-render';
import { resolveEdgeSeat, seatOffsetsAt } from '../../components/blocks/text/edge-seat';
import { MARKER_FAMILY_SELECTOR, screenVisibility } from '../../core/inline/visibility';
import type { EdgeAffinity } from '../../cursor/edge-affinity';
import { caretPositions, countOnScreen, paintedText } from '$lib/test/harness/painted-text';
import { arbInlineSource, freshOrFixedSeed } from './arbitraries';
import '../../schema/built-in-descriptors';

// Where a typed byte goes decides which side of an unpainted delimiter run it lands on. The check
// is the renderer, as it is in the split and join properties: a plain letter may never put a
// delimiter byte on screen, whatever position is chosen. A childless construct (an escape, an
// angle autolink) has no content range, so the choice declines and the byte lands between the
// delimiters, as in `\Z*Lead`.

// Miss analysis, twice over. Carets were every code-point stop at first, which put offsets inside
// painted literal delimiters, where any byte reshuffles the parse: a markdown consequence no caret
// choice can avoid, reported as a failure of that choice. The offsets now come from the renderer,
// covering only an unpainted run and its ends, which is where the choice has a job. The check
// stays one-sided (delimiters may not increase) because at an unpainted caret the byte appears
// nowhere at all.

// A delimiter that appears is then classified rather than excluded by the input's shape: `seam`
// where some offset the caret could have taken keeps the screen, `ambiguous` where none does and
// the parse rebinds under every answer, which is the byte-literal fallback § 4.4 declares. The
// labels are the live-gesture fuzzer's, so the two suites bucket the same finding the same way.

const PARAMS = { numRuns: 500, seed: freshOrFixedSeed(818818) } as const;

/** Every arrival the caret placement can be asked about, including the one that says nothing. */
const AFFINITIES: (EdgeAffinity | null)[] = ['near', 'far', 'outside', null];

/**
 * Delimiter bytes any construct can paint, plus the escape's own backslash. `_` is deliberately
 * left out: underscore emphasis is restricted inside a word, so a byte typed against `__x__` from
 * either outside edge kills the pair wherever the caret goes. That is markdown's own rule, not a
 * wrong choice of side. Every asterisk-spelled pair stays in, and they carry the same class.
 */
const DELIMITERS = '*~`<>\\';

/** Every fixture is a block holding content, so its markers hide: the live-mode reading. */
const LIVE = screenVisibility('live', { chromePaints: false });

/**
 * Which raw bytes the renderer does not show, read off the rendered DOM rather than the parse: a
 * chunk inside a `.md-marker` is unpainted, and so is a byte no chunk claims at all. An angle
 * autolink drops its brackets rather than wrapping them, which is the construct at issue here.
 */
function unpaintedBytes(raw: string): boolean[] {
	const fragment = renderInlineNodes(parseInline(raw, 0, raw.length), raw);
	const host = document.createElement('div');
	host.appendChild(fragment);
	const unpainted = new Array<boolean>(raw.length).fill(true);
	const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
	let at = 0;
	let node: Node | null;
	while ((node = walker.nextNode())) {
		const text = node.textContent ?? '';
		const found = raw.indexOf(text, at);
		if (text === '' || found === -1) continue;
		if (!node.parentElement?.closest(MARKER_FAMILY_SELECTOR)) {
			for (let i = found; i < found + text.length; i++) unpainted[i] = false;
		}
		at = found + text.length;
	}
	return unpainted;
}

/** The offsets the caret can be asked about: inside an unpainted run, or at one of its ends. */
function seatCarets(raw: string): number[] {
	const unpainted = unpaintedBytes(raw);
	return caretPositions(raw).filter(
		(stop) => unpainted[stop - 1] === true || unpainted[stop] === true
	);
}

/** Caret stops this property skips, per offset rather than per fixture: the span of a construct
 *  that paints nothing, which `[](url)` re-parses away under a byte anywhere in it. */
function excludedIntervals(display: string): [number, number][] {
	const intervals: [number, number][] = [];
	for (const node of parseInline(display, 0, display.length)) {
		if (display.slice(node.start, node.end).includes('[]')) intervals.push([node.start, node.end]);
	}
	return intervals;
}

/** Whether `after` is `before` with one `Z` spliced in and nothing else moved: this property's own
 *  version of the claim, asked of the renderer rather than of the `renderedText` reading the code
 *  under test verifies with, since sharing that check would echo it instead of testing it. */
function splicesTyped(before: string, after: string): boolean {
	if (after.length !== before.length + 1) return false;
	let at = 0;
	while (at < before.length && before[at] === after[at]) at++;
	return after[at] === 'Z' && after.slice(at + 1) === before.slice(at);
}

/** An offset the caret placement could have taken that keeps the screen, or undefined where the
 *  caret's whole screen position rebinds: `seam` against `ambiguous`. The range searched is the
 *  one the code can reach, so a failure never names an offset it could not have chosen. */
function rescueOffset(display: string, caret: number): number | undefined {
	const painted = paintedText(display);
	return seatOffsetsAt(caret, parseInline(display, 0, display.length), display, LIVE).find(
		(offset) =>
			splicesTyped(painted, paintedText(display.slice(0, offset) + 'Z' + display.slice(offset)))
	);
}

/** What gets written: the byte at the offset chosen, or at the caret when the choice declines. */
function typeThroughSeat(
	display: string,
	caret: number,
	affinity: EdgeAffinity | null
): { after: string; relocated: boolean } {
	const seat = resolveEdgeSeat(
		caret,
		parseInline(display, 0, display.length),
		affinity,
		display,
		LIVE,
		'Z'
	);
	const at = seat?.offset ?? caret;
	return { after: display.slice(0, at) + 'Z' + display.slice(at), relocated: seat !== null };
}

describe('the typing seat over generated inline fixtures', () => {
	// Moving the byte is the rare answer, so a run that never moved one proves nothing here.
	let relocated = 0;
	let declined = 0;
	let ambiguous = 0;

	it('a typed letter never puts a delimiter on screen the seat could have kept hidden', () => {
		fc.assert(
			fc.property(
				arbInlineSource,
				fc.nat(),
				fc.constantFrom(...AFFINITIES),
				(display, caretPick, affinity) => {
					const intervals = excludedIntervals(display);
					const stops = seatCarets(display).filter(
						(stop) => !intervals.some(([lo, hi]) => stop >= lo && stop <= hi)
					);
					if (stops.length === 0) return;
					const caret = stops[caretPick % stops.length];
					const before = countOnScreen(display, DELIMITERS);
					const { after, relocated: moved } = typeThroughSeat(display, caret, affinity);
					if (moved) relocated++;
					else declined++;
					const now = countOnScreen(after, DELIMITERS);
					if (now <= before) return;
					const rescue = rescueOffset(display, caret);
					if (rescue === undefined) {
						ambiguous++;
						return;
					}
					throw new Error(
						`${JSON.stringify(display)} @${caret} (${affinity}) → ${JSON.stringify(after)}: ` +
							`${before} delimiters on screen became ${now}, and a caret at ${rescue} keeps them hidden`
					);
				}
			),
			PARAMS
		);
	});

	it('both answers occurred', () => {
		expect(relocated).toBeGreaterThan(0);
		expect(declined).toBeGreaterThan(0);
	});

	// Zero on the fixed seed, and a ceiling rather than a floor: the shape turns up about once in
	// fifteen thousand draws, so one here means the search range shrank, and a candidate it can no
	// longer reach reads as markdown's fault. On a fresh seed a hit is a find worth looking at.
	it('no draw rebinds under every offset the seat can reach', () => {
		expect(ambiguous).toBe(0);
	});
});

// Shared asterisk runs, classified rather than excluded by the input's shape. Every such spelling
// has an answer now that the search covers the whole screen position rather than one run; where
// every offset in that position rebinds, the byte-literal write stands (§ 4.4) and the property
// reports which of the two it found instead of skipping the shape.
// Miss-analysis: the property excluded the class with a regex on the input, so no test here could
// see it until the exclusion became a classification.
describe('a surfaced delimiter is classified, never excluded', () => {
	// What is left is not a shared run: this emphasis encloses a bare autolink, and the trailing
	// `**a**` offers the parse a second pairing, so the opener's outside offset re-flanks into it
	// while its inside offset kills the URL.
	it('reports a screen position that rebinds under every offset as markdown’s own', () => {
		expect(rescueOffset('*www.example.com***a**', 0)).toBeUndefined();
		// The downstream run is what discriminates: the same opener alone still has an answer.
		expect(rescueOffset('*www.example.com*', 0)).toBe(0);
	});

	// What the classification may not swallow: a shared run the code can answer is still an answer,
	// and it lies in the neighbouring run rather than in this construct's own.
	it('still claims a shared run the seat can seat', () => {
		expect(rescueOffset('**a *b** c*', 0)).toBe(2);
		expect(typeThroughSeat('**a *b** c*', 0, 'near').after).toBe('**Za *b** c*');
	});
});
