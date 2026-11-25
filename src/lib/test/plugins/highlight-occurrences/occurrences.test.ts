// @vitest-environment node
// The two halves behind highlight-occurrences, each at its own level: the word under the caret
// (`wordAtCaret`, read through a document's `blockAt`) and the marks a block's paint answers.
import { describe, expect, it } from 'vitest';
import { grammar, type Block, type Doc, type Paint } from '#lib/plugin.js';
import {
	OCCURRENCE_CLASS,
	occurrenceMarks,
	wordAt,
	wordAtCaret
} from '#packages/highlight-occurrences/src/occurrences.js';

describe('wordAt', () => {
	it.each([
		['middle of a word', 'the cat ran', 5, 'cat', 4, 7],
		['word start prefers the char at the caret', 'the cat', 4, 'cat', 4, 7],
		['word end falls back to the char before', 'the cat', 7, 'cat', 4, 7],
		['whitespace after a word resolves the word before it', 'a bee', 1, 'a', 0, 1],
		['accented letters count as word chars', 'un café noir', 6, 'café', 3, 7],
		['digits and underscore join the word', 'x foo_2 y', 4, 'foo_2', 2, 7]
	])('%s', (_name, text, offset, word, start, end) => {
		expect(wordAt(text, offset)).toEqual({ word, start, end });
	});

	it.each([
		['punctuation on both sides', 'end. (x)', 4],
		['offset 0 on a non-word char', '# heading', 0],
		['empty text', '', 0],
		['offset out of range', 'abc', 9]
	])('returns null: %s', (_name, text, offset) => {
		expect(wordAt(text, offset)).toBeNull();
	});
});

const read = (text: string): Doc => grammar([]).parse(text);

/** The editor `wordAtCaret` reads: a caret at document byte `head`, or a selection over cells. */
function caretIn(doc: Doc, head: number | null, cells = false) {
	const selection =
		head === null ? null : ({ head, cells: cells ? { anchor: [0, 0] } : null } as never);
	return { selection, blockAt: (at: number) => doc.blockAt(at) };
}

describe('wordAtCaret', () => {
	const doc = read('cat one\n\n> a cat naps\n\n## cat title\n\ncatalog\n');

	it('reads the word under a caret in a top-level block', () => {
		expect(wordAtCaret(caretIn(doc, 1))).toBe('cat');
	});

	it('reads the word under a caret in a quote, past its marker', () => {
		expect(wordAtCaret(caretIn(doc, 'cat one\n\n> a c'.length))).toBe('cat');
	});

	it('reads nothing with no selection', () => {
		expect(wordAtCaret(caretIn(doc, null))).toBeNull();
	});

	it("reads nothing at a heading's marker", () => {
		expect(wordAtCaret(caretIn(doc, 'cat one\n\n> a cat naps\n\n#'.length))).toBeNull();
	});

	const table = read('| cat | dog |\n| --- | --- |\n| cat | nap |\n');

	it('reads nothing for a selection over table cells', () => {
		expect(wordAtCaret(caretIn(table, 3, true))).toBeNull();
	});

	it("reads the word under a caret in a table cell's text", () => {
		expect(wordAtCaret(caretIn(table, 3))).toBe('cat');
	});

	// Miss-analysis: every caret row sat mid-word in an LF document, so a caret at a nested CRLF
	// line's end, read past its `\r` while the byte map put the `\n` on that byte, found no word.
	it.each([
		['LF', '\n'],
		['CRLF', '\r\n']
	])("reads a quote line's last word under %s, the caret at the line's end", (_ending, eol) => {
		const source = 'intro\n\n> foo bar\n> baz qux\n'.replaceAll('\n', eol);
		const quoted = read(source);
		const endOf = (word: string) => source.indexOf(word + eol) + word.length;
		expect([endOf('bar'), endOf('qux')].map((at) => wordAtCaret(caretIn(quoted, at)))).toEqual([
			'bar',
			'qux'
		]);
		const open = `intro${eol}${eol}> foo bar`;
		expect(wordAtCaret(caretIn(read(open), open.length))).toBe('bar');
	});

	// A fenced code block is not prose, which is what the highlight limits itself to.
	it('reads nothing under a caret inside a code block', () => {
		const code = read('cat one\n\n```\ncat inside code\n```\n');
		expect(wordAtCaret(caretIn(code, 'cat one\n\n```\nc'.length))).toBeNull();
	});
});

/** Each mark's document bytes and the text they hold. */
const marked = (doc: Doc, word: string) =>
	[...doc.walk()].flatMap((block: Block) =>
		occurrenceMarks(block, word).map((paint: Paint) => {
			const { from, to } = paint as { from: number; to: number; class: string };
			expect((paint as { class: string }).class).toBe(OCCURRENCE_CLASS);
			return doc.text.slice(from, to);
		})
	);

describe('occurrenceMarks', () => {
	const doc = read('cat one\n\n> a cat naps\n\n## cat title\n\ncatalog\n');

	it('marks every whole-word occurrence in a paragraph, a quote and a heading, in document bytes', () => {
		const at = (block: Block) =>
			occurrenceMarks(block, 'cat').map((m) => (m as { from: number }).from);
		expect([...doc.walk()].flatMap(at)).toEqual([
			0,
			'cat one\n\n> a '.length,
			'cat one\n\n> a cat naps\n\n## '.length
		]);
		expect(marked(doc, 'cat')).toEqual(['cat', 'cat', 'cat']);
	});

	it('marks a longer word apart, never as a substring', () => {
		expect(marked(doc, 'catalog')).toEqual(['catalog']);
	});

	it("marks a word in a table's cells", () => {
		const table = read('| cat | dog |\n| --- | --- |\n| cat | nap |\n');
		expect(marked(table, 'cat')).toEqual(['cat', 'cat']);
	});

	it('marks nothing inside a code block', () => {
		const code = read('cat one\n\n```\ncat inside code\n```\n');
		expect(marked(code, 'cat')).toEqual(['cat']);
	});
});
