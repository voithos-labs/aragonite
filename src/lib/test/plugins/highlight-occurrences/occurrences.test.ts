// The two pure halves behind the highlight-occurrences plugin, each asserted at its
// own level: word-under-caret resolution (`anchorWord`) and the whole-document
// occurrence index the memoizing source looks that word up in.
import { describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import type { EditorSelection } from '$lib';
import {
	OCCURRENCE_CLASS,
	anchorWord,
	buildOccurrenceIndex,
	wordAt
} from '$lib/plugins/highlight-occurrences/occurrences';

function caret(path: number[], offset: number, cellCoordinate?: boolean): EditorSelection {
	const point = cellCoordinate ? { path, offset, cellCoordinate } : { path, offset };
	return { anchor: point, focus: point };
}

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

describe('anchorWord', () => {
	const doc = parse('cat one\n\n> a cat naps\n\n## cat title\n\ncatalog\n');

	it('resolves the word under a caret in a top-level leaf', () => {
		expect(anchorWord(doc, caret([0], 1))).toBe('cat');
	});

	it('returns null for a null selection', () => {
		expect(anchorWord(doc, null)).toBeNull();
	});

	it('returns null when the caret sits on a marker char', () => {
		expect(anchorWord(doc, caret([2], 1))).toBeNull();
	});

	it('returns null for a container focus (table cell-coordinate endpoint)', () => {
		const tableDoc = parse('| cat | dog |\n| --- | --- |\n| cat | nap |\n');
		expect(anchorWord(tableDoc, caret([0], 1, true))).toBeNull();
	});

	it('resolves through a deep cell path to the cell leaf', () => {
		const tableDoc = parse('| cat | dog |\n| --- | --- |\n| cat | nap |\n');
		expect(anchorWord(tableDoc, caret([0, 0, 0], 1))).toBe('cat');
	});

	// A fenced code block is not an inline-prose surface (supportsInline: false, read
	// through isProseKind) — the declared capability occurrence highlighting scopes to.
	it('returns null when the caret sits inside a non-prose leaf', () => {
		const codeDoc = parse('cat one\n\n```\ncat inside code\n```\n');
		// Offset 5 sits inside the fence body's 'cat' (raw: '```\ncat inside…').
		expect(anchorWord(codeDoc, caret([1], 5))).toBeNull();
	});
});

describe('buildOccurrenceIndex', () => {
	const doc = parse('cat one\n\n> a cat naps\n\n## cat title\n\ncatalog\n');

	it('indexes every whole-word occurrence across top-level, nested, and heading leaves', () => {
		expect(buildOccurrenceIndex(doc).index.get('cat')).toEqual([
			{ type: 'mark', path: [0], start: 0, end: 3, class: OCCURRENCE_CLASS },
			{ type: 'mark', path: [1, 0], start: 2, end: 5, class: OCCURRENCE_CLASS },
			// Heading offsets are raw offsets: 'cat' sits past the '## ' marker.
			{ type: 'mark', path: [2], start: 3, end: 6, class: OCCURRENCE_CLASS }
		]);
	});

	it('buckets a longer word separately, never as a substring match', () => {
		const { index } = buildOccurrenceIndex(doc);
		expect(index.get('cat')?.some((m) => m.path[0] === 3)).toBe(false);
		expect(index.get('catalog')?.map((m) => m.path)).toEqual([[3]]);
	});

	it('indexes table-cell leaves', () => {
		const tableDoc = parse('| cat | dog |\n| --- | --- |\n| cat | nap |\n');
		// The delimiter row is trivia, not a child: body cells sit on row 1.
		expect(
			buildOccurrenceIndex(tableDoc)
				.index.get('cat')
				?.map((m) => m.path)
		).toEqual([
			[0, 0, 0],
			[0, 1, 0]
		]);
	});

	it('skips non-prose leaves, so a word inside a fenced code block is never indexed', () => {
		const codeDoc = parse('cat one\n\n```\ncat inside code\n```\n');
		expect(
			buildOccurrenceIndex(codeDoc)
				.index.get('cat')
				?.map((m) => m.path)
		).toEqual([[0]]);
	});
});

// The scan is per-keystroke work, so what it may NOT redo is the load-bearing half: a leaf
// whose bytes did not move keeps the token list the previous scan produced.
describe('buildOccurrenceIndex token cache', () => {
	const doc = parse('cat one\n\ndog two\n');
	const rawOf = (parsed: ReturnType<typeof parse>, index: number) => parsed.children[index].raw;

	it('re-tokenizes only the leaf an edit changed, reusing the rest by identity', () => {
		const first = buildOccurrenceIndex(doc);
		expect(first.tokenizedLeaves).toBe(2);

		const edited = parse('cat one\n\ndog twos\n');
		const second = buildOccurrenceIndex(edited, first.tokens);
		expect(second.tokenizedLeaves).toBe(1);
		expect(second.tokens.get(rawOf(doc, 0))).toBe(first.tokens.get(rawOf(doc, 0)));
	});

	it('drops a leaf that left the document from the carried cache', () => {
		const first = buildOccurrenceIndex(doc);
		const shorter = parse('cat one\n');
		expect([...buildOccurrenceIndex(shorter, first.tokens).tokens.keys()]).toEqual([
			rawOf(shorter, 0)
		]);
	});

	it('tokenizes two leaves holding the same text once, marking both paths', () => {
		const twins = buildOccurrenceIndex(parse('same text\n\nsame text\n'));
		expect(twins.tokenizedLeaves).toBe(1);
		expect(twins.index.get('same')?.map((m) => m.path)).toEqual([[0], [1]]);
	});
});
