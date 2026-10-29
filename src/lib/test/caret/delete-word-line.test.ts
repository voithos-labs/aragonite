// The word and line units a collapsed delete takes, one rule on every engine.
// Miss-analysis: word and line deletes were the browser's, so no test named what one takes.
import { describe, expect, it } from 'vitest';
import {
	DELETE_WINDOW,
	deleteExtent,
	wordExtent,
	type DeleteContext,
	type ForwardWordReach
} from '#lib/caret/delete-extent.js';
import type { DeleteIntent } from '#lib/browser/input.js';
import type { VisibleText } from '#lib/browser/offsets.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';

/** `text` with `|` marking the caret, and what a word delete leaves. */
function word(
	marked: string,
	direction: 'backward' | 'forward',
	reach: ForwardWordReach = 'next-word'
) {
	const caret = marked.indexOf('|');
	const text = marked.replace('|', '');
	const span = wordExtent(text, caret, direction, { start: 0, end: text.length }, reach);
	return span && text.slice(0, span.start) + '|' + text.slice(span.end);
}

describe('wordExtent: a word delete', () => {
	it.each([
		['foo bar|', 'foo |'],
		['foo bar  |', 'foo |'],
		['foo ba|r', 'foo |r'],
		['foo, |', 'foo|'],
		['foo...|', 'foo|'],
		['a 😀|', 'a |'],
		['a\n   |', 'a\n|']
	])('Backspace in %j leaves %j', (marked, left) => {
		expect(word(marked, 'backward')).toBe(left);
	});

	it.each([
		['foo| bar baz', 'foo|bar baz'],
		['f|oo bar', 'f|bar'],
		['foo|, bar', 'foo|bar']
	])('Delete in %j leaves %j, up to the next word', (marked, left) => {
		expect(word(marked, 'forward')).toBe(left);
	});

	// Apple's Option+Delete stops at the end of the word it takes, keeping the space after it.
	it.each([
		['foo| bar baz', 'foo| baz'],
		['f|oo bar', 'f| bar']
	])('Delete in %j leaves %j on Apple platforms', (marked, left) => {
		expect(word(marked, 'forward', 'word-end')).toBe(left);
	});

	// Miss-analysis: every row ran on Node's segmenter, which joins `foo.bar` as Firefox's and WebKit's
	// do, so nothing showed Chromium cutting it and the three engines' deletes taking different text.
	it.each([
		['foo.bar|', 'foo.|'],
		['|foo.bar', '|.bar'],
		['a:b|', 'a:|'],
		['pi 3.14|', 'pi |']
	])('a full stop or colon between letters ends a word: %j leaves %j', (marked, left) => {
		expect(word(marked, marked.startsWith('|') ? 'forward' : 'backward')).toBe(left);
	});

	it('takes nothing at a line break, which a character delete takes instead', () => {
		expect(word('a\n|b', 'backward')).toBeNull();
		expect(word('a|\nb', 'forward')).toBeNull();
	});

	it('stays inside its bounds', () => {
		expect(wordExtent('abc def', 7, 'backward', { start: 5, end: 7 }, 'next-word')).toEqual({
			start: 5,
			end: 7
		});
	});

	it('takes a word longer than the window whole', () => {
		const long = 'x'.repeat(DELETE_WINDOW * 3);
		expect(word(`a ${long}|`, 'backward')).toBe('a |');
		expect(word(`|${long} b`, 'forward')).toBe('|b');
	});

	it('reads a fixed window around the caret in a long text', () => {
		const text = 'word '.repeat(2000);
		resetPerfInstruments();
		enablePerfInstruments();
		try {
			wordExtent(text, 5000, 'backward', { start: 0, end: text.length }, 'next-word');
			wordExtent(text, 5000, 'forward', { start: 0, end: text.length }, 'next-word');
			expect(perfSnapshot().deleteWindowUnits).toBeLessThanOrEqual(2 * DELETE_WINDOW);
		} finally {
			disablePerfInstruments();
		}
	});
});

const intent = (unit: DeleteIntent['unit'], direction: DeleteIntent['direction']) => ({
	unit,
	direction
});

/** What `intent` leaves of `marked`, `|` marking the caret. */
function take(marked: string, of: DeleteIntent, extra: Partial<DeleteContext> = {}) {
	const caret = marked.indexOf('|');
	const text = marked.replace('|', '');
	const span = deleteExtent(of, { text, caret, bounds: { start: 0, end: text.length }, ...extra });
	return span && text.slice(0, span.start) + '|' + text.slice(span.end);
}

describe('deleteExtent: a line delete', () => {
	it.each([
		['ab\ncd|ef', 'backward', 'ab\n|ef'],
		['ab\ncd|ef\ngh', 'forward', 'ab\ncd|\ngh'],
		['ab|cd\r\nx', 'forward', 'ab|\r\nx']
	] as const)('a hard line delete in %j, %s, leaves %j', (marked, direction, left) => {
		expect(take(marked, intent('hard-line', direction))).toBe(left);
	});

	it('takes the line ending when the caret is already at the line edge', () => {
		expect(take('ab\r\n|cd', intent('hard-line', 'backward'))).toBe('ab|cd');
		expect(take('ab|\r\ncd', intent('hard-line', 'forward'))).toBe('ab|cd');
	});

	it('takes a soft line to the edge the screen wraps at, else to the hard line edge', () => {
		const lineEdge = (side: 'start' | 'end') => (side === 'start' ? 3 : null);
		expect(take('ab cd ef|', intent('soft-line', 'backward'), { lineEdge })).toBe('ab |');
		expect(take('ab|cd\nef', intent('soft-line', 'forward'), { lineEdge })).toBe('ab|\nef');
	});

	// A null extent reads as the block's edge, where the delete runs the plain key's merge.
	it('finds something to take at a wrapped line start inside the block, so it never merges', () => {
		const lineEdge = (side: 'start' | 'end') => (side === 'start' ? 6 : 8);
		for (const unit of ['soft-line', 'hard-line', 'word'] as const) {
			expect(take('ab cd |ef', intent(unit, 'backward'), { lineEdge })).not.toBeNull();
			expect(take('ab cd |ef', intent(unit, 'forward'), { lineEdge })).not.toBeNull();
		}
		expect(take('|ab', intent('soft-line', 'backward'), { lineEdge: () => 0 })).toBeNull();
	});
});

describe('deleteExtent: a word read as the screen shows it', () => {
	/** `a **bold** c` in live mode: the `**` runs paint nothing, so the screen reads `a bold c`. */
	const RAW = 'a **bold** c';
	const visible: VisibleText = {
		text: 'a bold c',
		rawStart: [0, 1, 4, 5, 6, 7, 10, 11],
		rawEnd: [1, 2, 5, 6, 7, 8, 11, 12]
	};
	const at = (caret: number, direction: 'backward' | 'forward') =>
		deleteExtent(intent('word', direction), {
			text: RAW,
			caret,
			bounds: { start: 0, end: RAW.length },
			visible: () => visible
		});

	it('takes the word inside the hidden run, not the run as a word of its own', () => {
		expect(at(10, 'backward')).toEqual({ start: 4, end: 10 });
		expect(at(8, 'backward')).toEqual({ start: 4, end: 8 });
	});

	it('takes the word after hidden markers forward, up to the next word', () => {
		expect(at(2, 'forward')).toEqual({ start: 2, end: 11 });
	});

	it('takes a widget, one character on screen, as a word of its own', () => {
		const raw = 'a &copy;b';
		const widget: VisibleText = {
			text: 'a ￼b',
			rawStart: [0, 1, 2, 8],
			rawEnd: [1, 2, 8, 9]
		};
		const context = { text: raw, caret: 8, bounds: { start: 0, end: 9 }, visible: () => widget };
		expect(deleteExtent(intent('word', 'backward'), context)).toEqual({ start: 2, end: 8 });
	});
});
