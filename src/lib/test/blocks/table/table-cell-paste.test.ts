import { describe, it, expect } from 'vitest';
import type { CstNode } from '../../../core/nodes';
import {
	escapeCellCommit,
	escapeUnescapedPipes,
	normalizeWhitespace,
	tableCellInlinePaste
} from '../../../components/blocks/table/table-cell-paste';
import { rebuildTableRowRaw } from '../../../schema/container-rebuilders';
import { splitRowCells } from '../../../core/parsers/table';

function makeCell(raw: string): CstNode {
	return { kind: 'tableCell', leadingTrivia: '', raw };
}

function makeRow(cellRaws: string[]): CstNode {
	return {
		kind: 'tableRow',
		leadingTrivia: '',
		raw: '',
		metadata: { isHeader: false },
		children: cellRaws.map(makeCell)
	};
}

describe('escapeUnescapedPipes', () => {
	it('escapes a bare pipe', () => {
		expect(escapeUnescapedPipes('foo|bar')).toBe('foo\\|bar');
	});

	it('leaves an already-escaped pipe alone (1 backslash, odd)', () => {
		expect(escapeUnescapedPipes('foo\\|bar')).toBe('foo\\|bar');
	});

	it('escapes when preceded by an even backslash run (2)', () => {
		expect(escapeUnescapedPipes('foo\\\\|bar')).toBe('foo\\\\\\|bar');
	});

	it('returns input unchanged when no pipes present', () => {
		expect(escapeUnescapedPipes('foo bar baz')).toBe('foo bar baz');
	});

	it('escapes a leading pipe at string start', () => {
		expect(escapeUnescapedPipes('|foo')).toBe('\\|foo');
	});

	it('handles a mix of escaped and unescaped pipes', () => {
		expect(escapeUnescapedPipes('a|b\\|c|d')).toBe('a\\|b\\|c\\|d');
	});
});

describe('normalizeWhitespace', () => {
	it('replaces a single newline with a space', () => {
		expect(normalizeWhitespace('a\nb')).toBe('a b');
	});

	it('collapses a run of newlines into a single space', () => {
		expect(normalizeWhitespace('a\n\n\nb')).toBe('a b');
	});

	it('trims leading and trailing whitespace', () => {
		expect(normalizeWhitespace('  hello  ')).toBe('hello');
	});

	it('preserves internal single spaces', () => {
		expect(normalizeWhitespace('a b c')).toBe('a b c');
	});
});

describe('escapeCellCommit — typed pipe survives rebuild + reparse', () => {
	it('escapes a typed pipe and shifts the caret past the inserted backslash', () => {
		// Cell was "ab"; the user typed "|" between a and b, DOM caret at 2.
		const committed = escapeCellCommit('a|b', 2);
		expect(committed.text).toBe('a\\|b');
		expect(committed.caret).toBe(3);
	});

	it('leaves pipe-free input and its caret untouched', () => {
		expect(escapeCellCommit('hello', 2)).toEqual({ text: 'hello', caret: 2 });
	});

	it('escaped cell keeps the row column count on reparse (U7 — no cell drop)', () => {
		// Without escaping, a cell of "a|b" makes the row raw "| a|b | y |", which
		// reparses to three cells — a 2-col table then truncates, dropping "y".
		expect(splitRowCells('| a|b | y |\n')).toEqual(['a', 'b', 'y']);

		const { text } = escapeCellCommit('a|b', 2);
		const row = makeRow([text, 'y']);
		rebuildTableRowRaw(row);
		expect(row.raw).toBe('| a\\|b | y |\n');
		expect(splitRowCells(row.raw)).toEqual(['a\\|b', 'y']);
	});
});

describe('tableCellInlinePaste', () => {
	it('inserts at offset, normalizing newlines and escaping pipes', () => {
		const cell = makeCell('pre');
		const result = tableCellInlinePaste(cell, 3, 'a|b\nc');
		expect(result.newRaw).toBe('prea\\|b c');
		expect(result.caretOffset).toBe(3 + 'a\\|b c'.length);
	});

	it('honors preDelete by deleting the range first then pasting at the deletion start', () => {
		const cell = makeCell('abcdef');
		const result = tableCellInlinePaste(cell, 5, 'X', { start: 1, end: 4 });
		expect(result.newRaw).toBe('aXef');
		expect(result.caretOffset).toBe(2);
	});
});
