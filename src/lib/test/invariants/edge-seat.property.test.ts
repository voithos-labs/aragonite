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

// The typing seat decides which side of an unpainted delimiter run a byte lands on, and it was
// the one live rewrite with no property net. The oracle is the PAINTER, as it is in the split and
// join nets: a plain letter may never put a delimiter byte on screen, whatever the seat answers.
// It found its class on the first run — a childless construct (an escape, an angle autolink) has
// no content range, so the seat declined and the byte landed between delimiters (`\Z*Lead`).

// Miss analysis, twice. Carets were every code-point stop first, which drove offsets inside
// PAINTED literal delimiters, where any byte reshuffles the parse — a markdown casualty no seat
// can avert, reported as a seat failure. They are derived from the PAINTER now: only the offsets
// in and against an unpainted run, which is where a seat has a job. The oracle stays one-sided
// (delimiters may not INCREASE) because at an unpainted caret the byte appears nowhere at all.

// A delimiter that surfaces is then CLASSIFIED rather than excluded by input shape (#116): `seam`
// where some offset the seat could have taken keeps the screen, `ambiguous` where none does and
// the parse rebinds under every answer, which is the byte-literal fallback § 4.4 declares. The
// vocabulary is the live-gesture fuzzer's, so the two nets bucket the same finding the same way.

const PARAMS = { numRuns: 500, seed: freshOrFixedSeed(818818) } as const;

/** A ceiling, never a floor, and low enough that a SINGLE ambiguous draw trips it: the fixed lane
 *  finds none, and a fresh one meets the shape about once in fifteen thousand draws. What it
 *  catches is the seat's REACH shrinking, since a candidate it can no longer see reads as
 *  markdown's fault; a fresh-seed fire is a find to look at, which is what that lane is for. */
const AMBIGUOUS_RATE_CEILING = 0.001;

/** Every arrival a seat can be asked about, including the one that says nothing yet. */
const AFFINITIES: (EdgeAffinity | null)[] = ['near', 'far', 'outside', null];

/**
 * Delimiter bytes any construct can paint, plus the escape's own backslash. `_` is deliberately
 * OUT: underscore emphasis is intraword-restricted, so a byte typed against `__x__` from either
 * outside edge kills the pair whatever the seat answers — markdown's own rule, not a seat that
 * chose the wrong side. Every asterisk-spelled pair stays in, and they carry the same class.
 */
const DELIMITERS = '*~`<>\\';

/** Every fixture is a block holding content, so its chrome hides: the live reading. */
const LIVE = screenVisibility('live', { chromePaints: false });

/**
 * Which raw bytes the painter does NOT show, read off the rendered DOM rather than the parse: a
 * chunk inside a `.md-marker` is unpainted, and so is a byte no chunk claims at all — an angle
 * autolink drops its brackets rather than wrapping them, which is the very construct at issue.
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

/** The offsets a seat can be asked about: inside an unpainted run, or against one of its ends. */
function seatCarets(raw: string): number[] {
	const unpainted = unpaintedBytes(raw);
	return caretPositions(raw).filter(
		(stop) => unpainted[stop - 1] === true || unpainted[stop] === true
	);
}

/** Caret stops the net skips, per offset rather than per fixture (#117): the span of a construct
 *  that paints NOTHING, which `[](url)` re-parses away under a byte anywhere in it. */
function excludedIntervals(display: string): [number, number][] {
	const intervals: [number, number][] = [];
	for (const node of parseInline(display, 0, display.length)) {
		if (display.slice(node.start, node.end).includes('[]')) intervals.push([node.start, node.end]);
	}
	return intervals;
}

/** Whether `after` is `before` with one `Z` spliced in and nothing else moved — the net's own
 *  version of the seat's claim, asked of the PAINTER rather than of the `renderedText` reading the
 *  seat verifies with, since an oracle sharing that check echoes the seam instead of contesting it. */
function splicesTyped(before: string, after: string): boolean {
	if (after.length !== before.length + 1) return false;
	let at = 0;
	while (at < before.length && before[at] === after[at]) at++;
	return after[at] === 'Z' && after.slice(at + 1) === before.slice(at);
}

/** The offset a seat could have taken that keeps the screen, or undefined where the caret's whole
 *  screen position rebinds — `seam` against `ambiguous`. The reach is the seat's own, so a red
 *  never names an offset the seat is structurally unable to reach. */
function rescueOffset(display: string, caret: number): number | undefined {
	const painted = paintedText(display);
	return seatOffsetsAt(caret, parseInline(display, 0, display.length), display, LIVE).find(
		(offset) =>
			splicesTyped(painted, paintedText(display.slice(0, offset) + 'Z' + display.slice(offset)))
	);
}

/** What the seat writes: the byte at the offset it answers, or at the caret when it declines. */
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
	// Relocating is the rare answer, so a run that never relocated proves nothing about the seat.
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
							`${before} delimiters on screen became ${now}, and a seat at ${rescue} keeps them hidden`
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

	it('markdown’s own rebinding stays the rare answer', () => {
		expect(ambiguous / (relocated + declined)).toBeLessThan(AMBIGUOUS_RATE_CEILING);
	});
});

// #116's class, classified rather than excluded by input shape. Every shared-asterisk-run spelling
// the issue named HAS an answer now that the seat reaches the whole screen position rather than one
// run; where every offset that position names rebinds, the byte-literal write stands (§ 4.4) and
// the net reports which of the two it found instead of skipping the shape.
describe('a surfaced delimiter is classified, never excluded', () => {
	// The residue is not a shared run: this emphasis encloses a BARE autolink, and at its opener the
	// outside offset kills the emphasis while the inside one kills the URL.
	it('reports a screen position that rebinds under every offset as markdown’s own', () => {
		expect(rescueOffset('*www.example.com***a**', 0)).toBeUndefined();
	});

	// What the classification may not swallow: a shared run the seat CAN answer is still a claim,
	// and the answer lies in the neighbouring run rather than in this construct's own.
	it('still claims a shared run the seat can seat', () => {
		expect(rescueOffset('**a *b** c*', 0)).toBe(2);
		expect(typeThroughSeat('**a *b** c*', 0, 'near').after).toBe('**Za *b** c*');
	});
});
