// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseInline } from '../../core/inline';
import { renderInlineNodes } from '../../core/inline-render';
import { resolveEdgeSeat } from '../../components/blocks/text/edge-seat';
import type { EdgeAffinity } from '../../cursor/edge-affinity';
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

const PARAMS = { numRuns: 500, seed: freshOrFixedSeed(818818) } as const;

/** Every arrival a seat can be asked about, including the one that says nothing yet. */
const AFFINITIES: (EdgeAffinity | null)[] = ['near', 'far', 'outside', null];

/**
 * Delimiter bytes any construct can paint, plus the escape's own backslash. `_` is deliberately
 * OUT: underscore emphasis is intraword-restricted, so a byte typed against `__x__` from either
 * outside edge kills the pair whatever the seat answers — markdown's own rule, not a seat that
 * chose the wrong side. Every asterisk-spelled pair stays in, and they carry the same class.
 */
const DELIMITERS = '*~`<>\\';

/**
 * The DOM the block actually paints, marker subtrees skipped. Deliberately the painter rather
 * than `renderedText`: the seams under test call that themselves, and an oracle that shares the
 * check echoes it instead of contesting it.
 */
function paintedText(raw: string): string {
	const fragment = renderInlineNodes(parseInline(raw, 0, raw.length), raw);
	const host = document.createElement('div');
	host.appendChild(fragment);
	const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
	let out = '';
	let node: Node | null;
	while ((node = walker.nextNode())) {
		if (!node.parentElement?.closest('.md-marker')) out += node.textContent ?? '';
	}
	return out;
}

function delimitersOnScreen(raw: string): number {
	let count = 0;
	for (const char of paintedText(raw)) if (DELIMITERS.includes(char)) count++;
	return count;
}

/** Code-point boundaries only: an offset inside a surrogate pair is not a caret. */
function caretPositions(text: string): number[] {
	const stops = [0];
	for (const char of text) stops.push(stops[stops.length - 1] + char.length);
	return stops;
}

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
		if (!node.parentElement?.closest('.md-marker')) {
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
 *  that paints NOTHING (`[](url)` re-parses away under a byte anywhere in it), and a 3+ asterisk
 *  run ±1 — a run SHARED between a nested pair, so either side rebinds which delimiters pair
 *  with which: the pre-existing seat weakness tracked as #116, not this class. */
function excludedIntervals(display: string): [number, number][] {
	const intervals: [number, number][] = [];
	for (const node of parseInline(display, 0, display.length)) {
		if (display.slice(node.start, node.end).includes('[]')) intervals.push([node.start, node.end]);
	}
	for (const match of display.matchAll(/\*{3,}/g)) {
		intervals.push([match.index - 1, match.index + match[0].length + 1]);
	}
	return intervals;
}

/** What the seat writes: the byte at the offset it answers, or at the caret when it declines. */
function typeThroughSeat(
	display: string,
	caret: number,
	affinity: EdgeAffinity | null
): { after: string; relocated: boolean } {
	const seat = resolveEdgeSeat(caret, parseInline(display, 0, display.length), affinity, display);
	const at = seat?.offset ?? caret;
	return { after: display.slice(0, at) + 'Z' + display.slice(at), relocated: seat !== null };
}

describe('the typing seat over generated inline fixtures', () => {
	// Relocating is the rare answer, so a run that never relocated proves nothing about the seat.
	let relocated = 0;
	let declined = 0;

	it('a typed letter never puts a delimiter on screen', () => {
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
					const before = delimitersOnScreen(display);
					const { after, relocated: moved } = typeThroughSeat(display, caret, affinity);
					if (moved) relocated++;
					else declined++;
					const now = delimitersOnScreen(after);
					if (now > before) {
						throw new Error(
							`${JSON.stringify(display)} @${caret} (${affinity}) → ${JSON.stringify(after)}: ` +
								`${before} delimiters on screen became ${now}`
						);
					}
				}
			),
			PARAMS
		);
	});

	it('both answers occurred', () => {
		expect(relocated).toBeGreaterThan(0);
		expect(declined).toBeGreaterThan(0);
	});
});
