import { describe, expect, it } from 'vitest';
import { parseInline } from '#lib';
import { isCheckable, spanAt, wordSpans, type InlineRun } from '#packages/spellcheck/src/words.js';

const spans = (raw: string) => wordSpans(raw, parseInline(raw, 0, raw.length));
const words = (raw: string) => spans(raw).map((s) => s.word);
const text = (start: number, end: number): InlineRun => ({ kind: 'text', start, end });

describe('wordSpans', () => {
	it('reads plain words with raw offsets', () => {
		expect(spans('one two')).toEqual([
			{ word: 'one', start: 0, end: 3 },
			{ word: 'two', start: 4, end: 7 }
		]);
	});

	it('keeps apostrophes inside a word, plain or typographic', () => {
		expect(words("don't it’s dogs'")).toEqual(["don't", 'it’s', 'dogs']);
	});

	it('reads words inside emphasis and a link’s label at their raw offsets', () => {
		expect(spans('a **bold** word')).toEqual([
			{ word: 'bold', start: 4, end: 8 },
			{ word: 'word', start: 11, end: 15 }
		]);
		expect(words('[teh label](http://exmaple.com)')).toEqual(['teh', 'label']);
		expect(words('*soft* ~~gone~~')).toEqual(['soft', 'gone']);
	});

	it('skips code spans, destinations, autolinks, bare links, emails, raw HTML, alts and escapes', () => {
		expect(
			words(
				'see `teh` <http://exmaple.com> https://exmaple.com/teh mail@exmaple.com <b>x</b> ![teh](a.png) \\*star ok'
			)
		).toEqual(['see', 'star', 'ok']);
	});

	it('reads only text reached through prose constructs, so a kind it doesn’t know is skipped', () => {
		const raw = '$teh$ `teh` ok';
		const inline: InlineRun[] = [
			{ kind: 'latex-math', start: 0, end: 5, children: [text(1, 4)] },
			{ kind: 'inlineCode', start: 6, end: 11, children: [text(7, 10)] },
			text(11, 14)
		];
		expect(wordSpans(raw, inline).map((s) => s.word)).toEqual(['ok']);
	});

	it('splits at a line ending, CRLF included, with the offsets of the bytes', () => {
		expect(spans('one\r\ntwo')).toEqual([
			{ word: 'one', start: 0, end: 3 },
			{ word: 'two', start: 5, end: 8 }
		]);
	});

	it('skips identifiers, numbers, camelCase and single letters', () => {
		expect(words('x abc123 snake_case camelCase 42nd e.g. ok')).toEqual(['ok']);
	});
});

describe('isCheckable', () => {
	it.each([
		['hello', true],
		['Hello', true],
		['HELLO', true],
		['iPhone', false],
		['a', false],
		['b2b', false]
	])('%s → %s', (word, expected) => {
		expect(isCheckable(word)).toBe(expected);
	});
});

describe('spanAt', () => {
	const list = spans('one two');
	it('names the word at an offset, both bounds included', () => {
		expect(spanAt(list, 0)?.word).toBe('one');
		expect(spanAt(list, 3)?.word).toBe('one');
		expect(spanAt(list, 4)?.word).toBe('two');
		expect(spanAt(list, 7)?.word).toBe('two');
	});
	it('is null between words and past the end', () => {
		expect(spanAt(spans('one  two'), 4)).toBeNull();
		expect(spanAt(list, 8)).toBeNull();
	});
});
