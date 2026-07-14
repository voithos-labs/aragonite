// The pure scan behind the highlight-occurrences dogfood: word-under-caret
// resolution and whole-word occurrence marks over the document's leaves.
import { describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import type { EditorSelection } from '$lib';
import {
	OCCURRENCE_CLASS,
	occurrenceMarks,
	wordAt
} from '../../../routes/test/plugins/highlight-occurrences/occurrences';

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

describe('occurrenceMarks', () => {
	const doc = parse('cat one\n\n> a cat naps\n\n## cat title\n\ncatalog\n');

	it('marks every whole-word occurrence across top-level, nested, and heading leaves', () => {
		const marks = occurrenceMarks(doc, caret([0], 1));
		expect(marks).toEqual([
			{ type: 'mark', path: [0], start: 0, end: 3, class: OCCURRENCE_CLASS },
			{ type: 'mark', path: [1, 0], start: 2, end: 5, class: OCCURRENCE_CLASS },
			// Heading offsets are raw offsets: 'cat' sits past the '## ' marker.
			{ type: 'mark', path: [2], start: 3, end: 6, class: OCCURRENCE_CLASS }
		]);
	});

	it('never matches a substring of a longer word', () => {
		const marks = occurrenceMarks(doc, caret([0], 1));
		expect(marks.some((m) => m.path[0] === 3)).toBe(false);
	});

	it('returns nothing for a null selection', () => {
		expect(occurrenceMarks(doc, null)).toEqual([]);
	});

	it('returns nothing when the caret sits on a marker char', () => {
		expect(occurrenceMarks(doc, caret([2], 1))).toEqual([]);
	});

	it('returns nothing for a container focus (table cell-coordinate endpoint)', () => {
		const tableDoc = parse('| cat | dog |\n| --- | --- |\n| cat | nap |\n');
		expect(occurrenceMarks(tableDoc, caret([0], 1, true))).toEqual([]);
	});

	it('marks occurrences inside table-cell leaves for a deep cell caret', () => {
		const tableDoc = parse('| cat | dog |\n| --- | --- |\n| cat | nap |\n');
		const marks = occurrenceMarks(tableDoc, caret([0, 0, 0], 1));
		// The delimiter row is trivia, not a child: body cells sit on row 1.
		expect(marks.map((m) => m.path)).toEqual([
			[0, 0, 0],
			[0, 1, 0]
		]);
	});
});
