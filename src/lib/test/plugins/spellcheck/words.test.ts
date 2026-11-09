// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Piece } from '#lib/plugin.js';
import { isCheckable, spanAt, wordSpans } from '#packages/spellcheck/src/words.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import { blockIn } from './reading-editor';

beforeAll(() => installLayoutStubs());
afterEach(() => destroyMountedEditors());

const spans = async (raw: string) => wordSpans(await blockIn(raw, 0));
const words = async (raw: string) => (await spans(raw)).map((s) => s.word);
const text = (raw: string, from: number, to: number): Piece => ({
	kind: 'text',
	from,
	to,
	text: raw.slice(from, to),
	children: [],
	is: () => false
});

describe('wordSpans', () => {
	it('reads plain words in document bytes', async () => {
		const doc = 'first block\n\none two\n';
		expect(wordSpans(await blockIn(doc, doc.indexOf('one')))).toEqual([
			{ word: 'one', from: doc.indexOf('one'), to: doc.indexOf('one') + 3 },
			{ word: 'two', from: doc.indexOf('two'), to: doc.indexOf('two') + 3 }
		]);
	});

	it('maps a word on a later line past the container marker in front of it', async () => {
		const doc = '> one\n> two\n';
		expect(wordSpans(await blockIn(doc, doc.indexOf('two')))).toEqual([
			{ word: 'one', from: 2, to: 5 },
			{ word: 'two', from: 8, to: 11 }
		]);
	});

	it('keeps apostrophes inside a word, plain or typographic', async () => {
		expect(await words("don't it’s dogs'")).toEqual(["don't", 'it’s', 'dogs']);
	});

	it('reads words inside emphasis and a link’s label at their bytes', async () => {
		expect(await spans('a **bold** word')).toEqual([
			{ word: 'bold', from: 4, to: 8 },
			{ word: 'word', from: 11, to: 15 }
		]);
		expect(await words('[teh label](http://exmaple.com)')).toEqual(['teh', 'label']);
		expect(await words('*soft* ~~gone~~')).toEqual(['soft', 'gone']);
	});

	it('skips code spans, destinations, autolinks, bare links, emails, raw HTML, alts and escapes', async () => {
		expect(
			await words(
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
		expect(wordSpans({ pieces }).map((s) => s.word)).toEqual(['ok']);
	});

	it('splits at a line ending, CRLF included, with the offsets of the bytes', async () => {
		expect(await spans('one\r\ntwo')).toEqual([
			{ word: 'one', from: 0, to: 3 },
			{ word: 'two', from: 5, to: 8 }
		]);
	});

	it('skips identifiers, numbers, camelCase and single letters', async () => {
		expect(await words('x abc123 snake_case camelCase 42nd e.g. ok')).toEqual(['ok']);
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
	it('names the word at a byte, both bounds included', async () => {
		const list = await spans('one two');
		expect([0, 3, 4, 7].map((at) => spanAt(list, at)?.word)).toEqual(['one', 'one', 'two', 'two']);
	});
	it('is null between words and past the end', async () => {
		expect(spanAt(await spans('one  two'), 4)).toBeNull();
		expect(spanAt(await spans('one two'), 8)).toBeNull();
	});
});
