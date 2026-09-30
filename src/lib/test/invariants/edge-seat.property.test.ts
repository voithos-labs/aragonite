// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { defaultGrammarView } from '$lib/schema/block-openers';
import fc from 'fast-check';
import { parseInline } from '../../core/inline';
import { renderInlineNodes } from '../../core/inline-render';
import { resolveEdgeSeat, seatOffsetsAt } from '../../components/blocks/text/edge-seat';
import { MARKER_FAMILY_SELECTOR, screenVisibility } from '../../core/inline/visibility';
import type { EdgeAffinity } from '../../cursor/edge-affinity';
import { caretPositions, countOnScreen, paintedText } from '$lib/test/harness/painted-text';
import { arbInlineSource, freshOrFixedSeed } from './arbitraries';
import '../../schema/built-in-descriptors';
import { renderOptions } from '../harness/fixture-grammar';
import { fixtureReading } from '$lib/test/harness/fixture-grammar';

// A letter typed at an unpainted delimiter run may never put a delimiter byte on screen, as the
// renderer draws it; a childless construct declines, so its byte lands between the delimiters.

// Carets sit only in an unpainted run or at its ends, where the choice has a job. The check is
// one-sided (delimiters may not increase), since at an unpainted caret the byte appears nowhere.

// A delimiter that appears is classified: `seam` where a reachable offset keeps the screen, and
// `ambiguous` where none does, the byte-literal fallback of live-mode.md § 4.4.

const FIXED_SEED = 818818;
const PARAMS = { numRuns: 500, seed: freshOrFixedSeed(FIXED_SEED) } as const;

/** Every arrival the caret placement can be asked about, including the one that says nothing. */
const AFFINITIES: (EdgeAffinity | null)[] = ['near', 'far', 'outside', null];

/** Delimiter bytes any construct can paint, plus the escape's backslash. `_` is left out: a byte
 *  typed at either outside edge of `__x__` kills the pair wherever it goes, by markdown's rule. */
const DELIMITERS = '*~`<>\\';

/** Every fixture is a block holding content, so its markers hide: the live-mode reading. */
const LIVE = screenVisibility('live', { chromePaints: false });

/** Raw bytes the rendered DOM does not show: a `.md-marker` chunk, and any byte no chunk holds,
 *  which is how an angle autolink drops its brackets. */
function unpaintedBytes(raw: string): boolean[] {
	const fragment = renderInlineNodes(parseInline(raw, 0, raw.length), raw, renderOptions());
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

/** Whether `after` is `before` with one `Z` spliced in, asked of the renderer: reusing the
 *  `renderedText` check the code under test uses would echo it instead of testing it. */
function splicesTyped(before: string, after: string): boolean {
	if (after.length !== before.length + 1) return false;
	let at = 0;
	while (at < before.length && before[at] === after[at]) at++;
	return after[at] === 'Z' && after.slice(at + 1) === before.slice(at);
}

/** An offset the caret placement can reach that keeps the screen (`seam`), or undefined where
 *  every reachable one rebinds it (`ambiguous`). */
function rescueOffset(display: string, caret: number): number | undefined {
	const painted = paintedText(display);
	return seatOffsetsAt(
		caret,
		parseInline(display, 0, display.length),
		display,
		LIVE,
		defaultGrammarView
	).find((offset) =>
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
		'Z',
		fixtureReading()
	);
	const at = seat?.offset ?? caret;
	return { after: display.slice(0, at) + 'Z' + display.slice(at), relocated: seat !== null };
}

describe('the typing caret position over generated inline fixtures', () => {
	// Moving the byte is the rare answer, so a run that never moved one proves nothing here.
	let relocated = 0;
	let declined = 0;
	let ambiguous = 0;

	it('a typed letter never puts a delimiter on screen the caret position could have kept hidden', () => {
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

	// Zero on the fixed seed, as a ceiling: the shape turns up about once in fifteen thousand draws,
	// so a hit here means the search range shrank. A fresh seed can draw it, pinned below.
	it.runIf(PARAMS.seed === FIXED_SEED)(
		'no draw rebinds under every offset the caret can reach',
		() => {
			expect(ambiguous).toBe(0);
		}
	);
});

// Shared asterisk runs are classified as `seam` or `ambiguous`, never skipped.
// Miss-analysis: a regex on the input excluded the class, so no test here could see it.
describe('a surfaced delimiter is classified, never excluded', () => {
	// Not a shared run: the trailing `**a**` offers a second pairing, so the opener's outside offset
	// re-flanks into it while its inside offset kills the bare autolink's URL.
	it('reports a screen position that rebinds under every offset as markdown’s own', () => {
		expect(rescueOffset('*www.example.com***a**', 0)).toBeUndefined();
		// The downstream run is what discriminates: the same opener alone still has an answer.
		expect(rescueOffset('*www.example.com*', 0)).toBe(0);
	});

	// Miss-analysis: #590, the ceiling above holds on the fixed seed only; 2275518750 drew this.
	it('the fresh-seed draw is the same shape: a downstream run offers another pairing', () => {
		expect(rescueOffset('*www.example.com*&bar**lorem**', 0)).toBeUndefined();
	});

	// What the classification may not swallow: a shared run the code can answer is still an answer,
	// and it lies in the neighbouring run rather than in this construct's own.
	it('still claims a shared run the caret can sit in', () => {
		expect(rescueOffset('**a *b** c*', 0)).toBe(2);
		expect(typeThroughSeat('**a *b** c*', 0, 'near').after).toBe('**Za *b** c*');
	});
});
