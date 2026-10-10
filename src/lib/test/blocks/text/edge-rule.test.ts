// @vitest-environment jsdom
// At a hidden edge in live mode a letter joins what the visible character before the caret is in
// (at a line start, the one after) unless a caret memory record says otherwise, with one answer per
// screen position. Miss-analysis: every edge row placed the caret at one raw offset, so none saw the
// answer change with the side of a hidden run the browser put the caret on.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { seatOffsetsAt, typingOffset } from '#lib/components/blocks/text/edge-seat.js';
import { parseInline } from '#lib/core/inline/index.js';
import { screenVisibility } from '#lib/core/inline/visibility.js';
import type { EdgeAffinity } from '#lib/caret/edge-affinity.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountWithCaret
} from '#lib/test/harness/mount-editor.svelte.js';
import { insertBy } from '#lib/test/harness/insertion-routes.js';

const LIVE = screenVisibility('live', { chromePaints: false });

/** `line` with its `|` taken out, and where the `|` stood. */
function caretIn(line: string): { source: string; caret: number } {
	const caret = line.indexOf('|');
	return { source: line.slice(0, caret) + line.slice(caret + 1), caret };
}

/** The bytes a letter typed at each raw offset of the caret's screen position writes, one entry
 *  per offset, so two normalisations that disagree show up as two different strings. */
function lettersAt(line: string, record: EdgeAffinity | null): string[] {
	const { source, caret } = caretIn(line);
	const inlines = parseInline(source, 0, source.length);
	const reading = fixtureReading();
	// A never-extend edge lists only its outside offset, so the caret's own is added.
	const position = new Set([
		caret,
		...seatOffsetsAt(caret, inlines, source, LIVE, reading.grammar)
	]);
	expect(position.size, 'the caret sits at a hidden edge').toBeGreaterThan(1);
	return [...position].map((offset) => {
		const at = typingOffset(offset, inlines, record, source, LIVE, reading);
		return source.slice(0, at) + 'X' + source.slice(at);
	});
}

function expectOneAnswer(line: string, record: EdgeAffinity | null, want: string): void {
	const written = lettersAt(line, record);
	expect(written, `${line} with ${JSON.stringify(record)}`).toEqual(written.map(() => want));
}

// ── No record: the character before the caret decides ───────────────────────

const LEFT_NEIGHBOUR: [line: string, want: string][] = [
	['a **bold**| b', 'a **boldX** b'],
	['a *em*| b', 'a *emX* b'],
	['a ~~gone~~| b', 'a ~~goneX~~ b'],
	['a ***both***| b', 'a ***bothX*** b'],
	['a **bold**|', 'a **boldX**'],
	['a ~~gone~~|', 'a ~~goneX~~'],
	['a |**bold** b', 'a X**bold** b'],
	['a |*em* b', 'a X*em* b'],
	['a |~~gone~~ b', 'a X~~gone~~ b'],
	['a |***both*** b', 'a X***both*** b'],
	// Abutting constructs are one screen position; the letter before it is bold.
	['a **a**|*b* c', 'a **aX***b* c'],
	['a *a*|**b** c', 'a *aX***b** c'],
	// Nested emphasis of the same kind has no stop at the inner closer: `bold` holds the letter.
	['a *x _bold_| y* b', 'a *x _boldX_ y* b'],
	['a _x |*bold* y_ b', 'a _x X*bold* y_ b'],
	// A code chip with no record follows the same rule; its two drawn stops are records.
	['a `code`| b', 'a `codeX` b'],
	['a |`code` b', 'a X`code` b']
];

describe('with no record, the letter joins what the character before it is in', () => {
	it.each(LEFT_NEIGHBOUR)('%s', (line, want) => expectOneAnswer(line, null, want));
});

// At a line start there is no character before, so the one after decides.
const LINE_START: [line: string, want: string][] = [
	['|**bold** b', '**Xbold** b'],
	['|*em* b', '*Xem* b'],
	['|~~gone~~ b', '~~Xgone~~ b'],
	['|***both*** b', '***Xboth*** b'],
	['a\\\n|**bold** b', 'a\\\n**Xbold** b'],
	['a  \n|**bold** b', 'a  \n**Xbold** b']
];

describe('at a line start, the letter joins what the character after it is in', () => {
	it.each(LINE_START)('%s', (line, want) => expectOneAnswer(line, null, want));
});

// ── Never-extend kinds take no letter at their edge ─────────────────────────

// The caret stands at the run's inner end, the offset a browser can normalise it to.
const NEVER_EXTEND: [line: string, want: string][] = [
	['a [link|](u) b', 'a [link](u)X b'],
	['a [|link](u) b', 'a X[link](u) b'],
	['[|link](u) b', 'X[link](u) b'],
	['a <https://e.com|> b', 'a <https://e.com>X b'],
	['a <|https://e.com> b', 'a X<https://e.com> b'],
	['<|https://e.com> b', 'X<https://e.com> b'],
	// A link's text is the character before, and a link never extends, so neither does its run.
	['a [l|](u)**b** c', 'a [l](u)X**b** c']
];

describe('a link or an autolink never takes the letter at either edge', () => {
	it.each(NEVER_EXTEND)('%s, with no record', (line, want) => expectOneAnswer(line, null, want));
	it.each(NEVER_EXTEND)('%s, at a fresh start', (line, want) =>
		expectOneAnswer(line, 'outside', want)
	);
});

// ── A record says otherwise ─────────────────────────────────────────────────

// A fresh start (Enter, a click past a line's end) and a typed closer both mean outside every
// construct whose hidden run the caret touches.
const OUTSIDE: [line: string, want: string][] = [
	['a **bold**| b', 'a **bold**X b'],
	['a *em*| b', 'a *em*X b'],
	['a ~~gone~~| b', 'a ~~gone~~X b'],
	['a ***both***|', 'a ***both***X'],
	['|**bold** b', 'X**bold** b'],
	['|***both*** b', 'X***both*** b'],
	['a **a**|*b* c', 'a **a**X*b* c'],
	['a `code`| b', 'a `code`X b'],
	// Outside can't render after a run ending in punctuation, so the nearest boundary that can wins,
	// whichever raw offset the caret holds.
	['a ~~**both**~~|', 'a ~~**both**X~~']
];

describe('a fresh start or a typed closer puts the letter outside', () => {
	it.each(OUTSIDE)('%s', (line, want) => expectOneAnswer(line, 'outside', want));
});

describe('a code chip’s stop names the side the bar is drawn on', () => {
	it('outside, past the closing backtick', () => {
		expectOneAnswer('a `code`| b', { offset: 8 }, 'a `code`X b');
	});

	it('inside, before it', () => {
		expectOneAnswer('a `code`| b', { offset: 7 }, 'a `codeX` b');
	});
});

// ── The records typing leaves, through the typing path ──────────────────────

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

/** Each mark at its hidden closer, mid-line and at the line's end. */
const CLOSERS: [name: string, line: string][] = [
	['bold', 'a **two**|'],
	['bold mid-line', 'a **two**| b'],
	['italic', 'a *two*|'],
	['strikethrough mid-line', 'a ~~two~~| b']
];

describe.each(CLOSERS)('%s, at either raw offset of the closer', (_name, line) => {
	const { source, caret } = caretIn(line);
	const closer = delimiterBefore(line, caret);
	const offsets = [caret - closer.length, caret];
	const tail = source.slice(caret);

	it.each(offsets)('a held space keeps the next letter inside, from %i', async (at) => {
		const { editor, el } = mountWithCaret(`${source}\n`, at);
		await insertBy('hardware key', el, ' X');
		expect(editor.source()).toBe(`${source.slice(0, caret - closer.length)} X${closer}${tail}\n`);
	});

	it.each(offsets)('a typed closer puts the next letter outside, from %i', async (at) => {
		const { editor, el } = mountWithCaret(`${source}\n`, at);
		await insertBy('hardware key', el, `${closer}X`);
		expect(editor.source()).toBe(`${source.slice(0, caret)}X${tail}\n`);
	});
});

/** The closing delimiter written just before `|` in `line`. */
function delimiterBefore(line: string, caret: number): string {
	return /(\*\*|~~|\*)$/.exec(line.slice(0, caret))?.[1] ?? '';
}
