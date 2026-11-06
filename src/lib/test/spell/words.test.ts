import { describe, expect, it } from 'vitest';
import { parseInline } from '#lib/core/inline/index.js';
import { isCheckable, spanAt, wordSpans } from '#lib/spell/words.js';

const spans = (raw: string) => wordSpans(raw, parseInline(raw, 0, raw.length));
const words = (raw: string) => spans(raw).map((s) => s.word);

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

	it('skips code spans, link destinations, autolinks and raw HTML', () => {
		expect(
			words('see `teh code` and [teh label](http://exmaple.com) <http://exmaple.com> <b>x</b> ok')
		).toEqual(['see', 'and', 'teh', 'label', 'ok']);
	});

	it('reads words inside emphasis at their raw offsets', () => {
		expect(spans('a **bold** word')).toEqual([
			{ word: 'bold', start: 4, end: 8 },
			{ word: 'word', start: 11, end: 15 }
		]);
	});

	it('skips identifiers, numbers, camelCase and single letters', () => {
		expect(words('x abc123 snake_case camelCase 42nd e.g. ok')).toEqual(['ok']);
	});

	it('does not read an image alt or an escaped character as a word', () => {
		expect(words('![teh alt](a.png) \\*star')).toEqual(['star']);
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
