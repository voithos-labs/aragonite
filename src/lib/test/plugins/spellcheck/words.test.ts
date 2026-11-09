import { describe, expect, it } from 'vitest';
import { isCheckable, spanAt, wordSpans, type Piece } from '#packages/spellcheck/src/words.js';
import { textBlock } from './text-block';

const spans = (raw: string) => wordSpans(textBlock(raw));
const words = (raw: string) => spans(raw).map((s) => s.word);
const text = (raw: string, from: number, to: number): Piece => ({
	kind: 'text',
	from,
	to,
	text: raw.slice(from, to),
	children: []
});

describe('wordSpans', () => {
	it('reads plain words in document bytes', () => {
		expect(wordSpans(textBlock('one two', 40))).toEqual([
			{ word: 'one', from: 40, to: 43 },
			{ word: 'two', from: 44, to: 47 }
		]);
	});

	it('maps a word on a later line past the container marker in front of it', () => {
		expect(wordSpans(textBlock('one\ntwo', 10, '> '))).toEqual([
			{ word: 'one', from: 10, to: 13 },
			{ word: 'two', from: 16, to: 19 }
		]);
	});

	it('keeps apostrophes inside a word, plain or typographic', () => {
		expect(words("don't it’s dogs'")).toEqual(["don't", 'it’s', 'dogs']);
	});

	it('reads words inside emphasis and a link’s label at their bytes', () => {
		expect(spans('a **bold** word')).toEqual([
			{ word: 'bold', from: 4, to: 8 },
			{ word: 'word', from: 11, to: 15 }
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
		const pieces: Piece[] = [
			{ ...text(raw, 0, 5), kind: 'latex-math', children: [text(raw, 1, 4)] },
			{ ...text(raw, 6, 11), kind: 'inlineCode', children: [text(raw, 7, 10)] },
			text(raw, 11, 14)
		];
		const block = { ...textBlock(raw), pieces };
		expect(wordSpans(block).map((s) => s.word)).toEqual(['ok']);
	});

	it('splits at a line ending, CRLF included, with the offsets of the bytes', () => {
		expect(spans('one\r\ntwo')).toEqual([
			{ word: 'one', from: 0, to: 3 },
			{ word: 'two', from: 5, to: 8 }
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
	it('names the word at a byte, both bounds included', () => {
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
