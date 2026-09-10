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

describe('delimiter auto-pair', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		registerMathInline();
	});
	afterEach(resetPluginPlatformForTests);

	it('a typed backtick lands its twin after the caret', () => {
		expect(type('text here', 5, '`')).toEqual({ kind: 'write', text: 'text ``here', caret: 6 });
	});

	// The bug this exists for: a lone `$` typed ahead of an existing formula paired with that
	// formula's closer, wrapping the prose between them.
	it('a typed $ pairs with its twin, not the next formula', () => {
		expect(type('text and $x^2$ later', 5, '$')).toEqual({
			kind: 'write',
			text: 'text $$and $x^2$ later',
			caret: 6
		});
	});

	it('typing the closer over the twin steps past it', () => {
		expect(type('a ``', 3, '`')).toEqual({ kind: 'step-over', caret: 4, overConstruct: false });
		expect(type('a `code` b', 7, '`')).toEqual({ kind: 'step-over', caret: 8, overConstruct: true });
		expect(type('$x$', 2, '$')).toEqual({ kind: 'step-over', caret: 3, overConstruct: true });
	});

	// ``` is three keystrokes: the third extends the run rather than opening a new pair.
	it('extending a run inserts literally', () => {
		expect(type('``', 2, '`')).toBeNull();
		expect(type('$$', 2, '$')).toBeNull();
	});

	it('does not pair in front of another span\'s opener', () => {
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
		expect(type('cost $$', 6, '5')).toEqual({ kind: 'write', text: 'cost $5', caret: 7 });
		expect(type('$$', 1, ' ')).toEqual({ kind: 'write', text: '$ ', caret: 2 });
	});

	it('declines outside the content range and for multi-byte input', () => {
		expect(resolveDelimiterAutoPair('# head', { start: 2, end: 6 }, 1, '`')).toBeNull();
		expect(type('ab', 1, '``')).toBeNull();
	});

	it('without the math plugin $ is plain text', () => {
		resetPluginPlatformForTests();
		expect(type('cost ', 5, '$')).toBeNull();
		expect(type('cost ', 5, '`')).toEqual({ kind: 'write', text: 'cost ``', caret: 6 });
	});

	it('Backspace at an empty pair takes both twins, between them or after them', () => {
		expect(resolveEmptyPairBackspace('pay $$', 5)).toEqual({ kind: 'write', text: 'pay ', caret: 4 });
		expect(resolveEmptyPairBackspace('pay $$', 6)).toEqual({ kind: 'write', text: 'pay ', caret: 4 });
		expect(resolveEmptyPairBackspace('a `` b', 3)).toEqual({ kind: 'write', text: 'a  b', caret: 2 });
		expect(resolveEmptyPairBackspace('a `` b', 4)).toEqual({ kind: 'write', text: 'a  b', caret: 2 });
	});

	it('Backspace leaves a longer run, a lone delimiter and a non-pair byte alone', () => {
		expect(resolveEmptyPairBackspace('```', 2)).toBeNull();
		expect(resolveEmptyPairBackspace('```', 3)).toBeNull();
		expect(resolveEmptyPairBackspace('x$', 1)).toBeNull();
		expect(resolveEmptyPairBackspace('x$', 2)).toBeNull();
		expect(resolveEmptyPairBackspace('**', 1)).toBeNull();
	});
});
