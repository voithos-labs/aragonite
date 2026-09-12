import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	resolveDelimiterAutoPair,
	resolveEmptyPairBackspace
} from '$lib/components/blocks/text/delimiter-autopair';
import { resetPluginPlatformForTests } from '$lib/testing';
import { registerMathInline } from '$lib/plugins/latex/latex-kind';

const whole = (text: string) => ({ start: 0, end: text.length });
const type = (text: string, caret: number, typed: string) =>
	resolveDelimiterAutoPair(text, whole(text), caret, typed);
const written = (text: string, caret: number) => ({ kind: 'write', text, caret });
const closed = (text: string, caret: number) => ({ kind: 'close', text, caret });
const stepped = (caret: number, overConstruct: boolean) => ({
	kind: 'step-over',
	caret,
	overConstruct
});

describe('delimiter auto-pair', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		registerMathInline();
	});
	afterEach(resetPluginPlatformForTests);

	it('a typed backtick lands its twin after the caret', () => {
		expect(type('text here', 5, '`')).toEqual(written('text ``here', 6));
	});

	// The bug this exists for: a lone `$` typed ahead of an existing formula paired with that
	// formula's closer, wrapping the prose between them.
	it('a typed $ pairs with its twin, not the next formula', () => {
		expect(type('text and $x^2$ later', 5, '$')).toEqual(written('text $$and $x^2$ later', 6));
	});

	it('typing the closer over the twin steps past it', () => {
		expect(type('a ``', 3, '`')).toEqual(stepped(4, false));
		expect(type('a `code` b', 7, '`')).toEqual(stepped(8, true));
		expect(type('$x$', 2, '$')).toEqual(stepped(3, true));
	});

	// ``` is three keystrokes: the third extends the run rather than opening a new pair.
	it('extending a run inserts literally', () => {
		expect(type('``', 2, '`')).toBeNull();
		expect(type('$$', 2, '$')).toBeNull();
	});

	it("does not pair in front of another span's opener", () => {
		expect(type('a `code` b', 2, '`')).toBeNull();
	});

	it('the empty pair keeps its twin when the first byte makes a construct', () => {
		expect(type('a ``', 3, 'x')).toBeNull();
		expect(type('a $$', 3, 'y')).toBeNull();
		expect(type('a ``', 3, '1')).toBeNull();
	});

	// `$5` is a price and `$ ` is a shell prompt: the twin the keystroke left would only paint
	// as a stray dollar sign.
	it('the empty pair drops its twin when the first byte makes no construct', () => {
		expect(type('cost $$', 6, '5')).toEqual(written('cost $5', 7));
		expect(type('$$', 1, ' ')).toEqual(written('$ ', 2));
	});

	it('declines outside the content range and for multi-byte input', () => {
		expect(resolveDelimiterAutoPair('# head', { start: 2, end: 6 }, 1, '`')).toBeNull();
		expect(type('ab', 1, '``')).toBeNull();
	});

	it('without the math plugin $ is plain text', () => {
		resetPluginPlatformForTests();
		expect(type('cost ', 5, '$')).toBeNull();
		expect(type('cost ', 5, '`')).toEqual(written('cost ``', 6));
	});

	// ── The emphasis family ──────────────────────────────────────────────────

	it('* and _ pair singly and grow to a double pair on the second press', () => {
		expect(type('a ', 2, '*')).toEqual(written('a **', 3));
		expect(type('a **', 3, '*')).toEqual(written('a ****', 4));
		expect(type('a ', 2, '_')).toEqual(written('a __', 3));
	});

	it('* and _ do not pair straight after a word byte', () => {
		expect(type('2', 1, '*')).toBeNull();
		expect(type('snake', 5, '_')).toBeNull();
	});

	// A single tilde strikes in GFM, so `~5 minutes` must stay prose: only `~~` pairs.
	it('~ pairs only as a double run', () => {
		expect(type('a ', 2, '~')).toBeNull();
		expect(type('a ~', 3, '~')).toEqual(written('a ~~~~', 4));
		expect(type('a ~~~', 5, '~')).toBeNull();
	});

	// A closer typed by hand (no twin was there to step over) completes the construct, and the
	// byte after it belongs outside: the arm writes it and seats the caret past the run.
	// Miss-analysis: every closing row here had a twin to step over, so none typed the byte that
	// makes the construct and asked which side the next one lands on.
	it('a closer typed with no twin ahead closes the construct', () => {
		expect(type('Some *ab', 8, '*')).toEqual(closed('Some *ab*', 9));
		expect(type('Some `ab', 8, '`')).toEqual(closed('Some `ab`', 9));
		expect(type('$ab', 3, '$')).toEqual(closed('$ab$', 4));
	});

	// `**ab*` plus `*` is the second half of a double closer, not a lone opener to grow.
	it('a closer completing a double run closes rather than grows', () => {
		expect(type('**ab*', 5, '*')).toEqual(closed('**ab**', 6));
		expect(type('~~ab~', 5, '~')).toEqual(closed('~~ab~~', 6));
	});

	it('a press inside a closing run steps over it, byte by byte', () => {
		expect(type('a **x**', 5, '*')).toEqual(stepped(6, true));
		expect(type('a **x**', 6, '*')).toEqual(stepped(7, true));
		expect(type('a ~~x~~', 5, '~')).toEqual(stepped(6, true));
		expect(type('a _x_', 4, '_')).toEqual(stepped(5, true));
	});

	it('a double empty pair keeps or drops its twin run by what the first byte makes', () => {
		expect(type('a ****', 4, 'x')).toBeNull();
		expect(type('a ****', 4, ' ')).toEqual(written('a ** ', 5));
		expect(type('a ~~~~', 4, 'x')).toBeNull();
	});

	it('Backspace at an empty pair takes both runs, between them or after them', () => {
		expect(resolveEmptyPairBackspace('pay $$', 5)).toEqual(written('pay ', 4));
		expect(resolveEmptyPairBackspace('pay $$', 6)).toEqual(written('pay ', 4));
		expect(resolveEmptyPairBackspace('a ****', 4)).toEqual(written('a ', 2));
		expect(resolveEmptyPairBackspace('a `` b', 4)).toEqual(written('a  b', 2));
	});

	it('Backspace leaves a longer run, a lone delimiter and a non-pair byte alone', () => {
		expect(resolveEmptyPairBackspace('```', 2)).toBeNull();
		expect(resolveEmptyPairBackspace('```', 3)).toBeNull();
		expect(resolveEmptyPairBackspace('x$', 1)).toBeNull();
		expect(resolveEmptyPairBackspace('x$', 2)).toBeNull();
		// `**|` is a double opener with content ahead, never a stepped-over pair.
		expect(resolveEmptyPairBackspace('a **x', 4)).toBeNull();
		expect(resolveEmptyPairBackspace('a ****', 6)).toBeNull();
	});
});
