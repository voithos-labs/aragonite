import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parse } from '#lib/core/parser.js';
import { trimWhitespace } from '#lib/core/lines.js';
import type { CstNode } from '#lib/core/nodes.js';
import { rebuildTableRaw } from '#lib/schema/container-rebuilders.js';
import {
	escapeUnescapedPipes,
	normalizeCellRaw,
	tableCellWrite,
	unescapeCellPipes
} from '#lib/schema/table-cell-raw.js';
import { freshOrFixedSeed } from '../invariants/arbitraries';

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

describe('normalizeCellRaw', () => {
	it('collapses a line ending so the text cannot spill into the next row', () => {
		expect(normalizeCellRaw('a\nb')).toBe('a b');
		expect(normalizeCellRaw('a\r\nb')).toBe('a b');
	});

	it('escapes a delimiter freed by the collapse itself', () => {
		expect(normalizeCellRaw('a\n|b')).toBe('a \\|b');
	});

	// The write path applies this to whole raws that may already have been through it, so a second
	// pass must change nothing or the backslashes pile up.
	it('is idempotent', () => {
		for (const input of ['a|b', 'a\\|b', 'a\\\\|b', 'a\nb', 'plain']) {
			expect(normalizeCellRaw(normalizeCellRaw(input))).toBe(normalizeCellRaw(input));
		}
	});

	// `escapedCellOffset` maps a caret by running this pass over the prefix, which
	// is only exact because each character's output depends on no later character.
	it('is prefix-composable: a prefix normalizes to the prefix of the normalization', () => {
		const text = 'a|b\\|c\nd|e';
		const whole = normalizeCellRaw(text);
		for (let i = 0; i <= text.length; i++) {
			expect(whole.startsWith(normalizeCellRaw(text.slice(0, i)))).toBe(true);
		}
	});
});

// A cell has no line ending of its own, and a shared text route writes a block's text with one
// appended, so the rule drops it rather than turning it into a trailing space.
describe('the cell write rule', () => {
	const ctx = {
		node: parse('| a |\n| - |\n| x |\n').children[0],
		mode: 'authored',
		lineEnding: '\n'
	} as const;

	it('drops the trailing line ending a block write carries', () => {
		expect(tableCellWrite.normalize('a|b\n', ctx)).toBe('a\\|b');
		expect(tableCellWrite.normalize('a|b\r\n', ctx)).toBe('a\\|b');
	});

	it('maps a caret past the dropped ending onto the end of the stored bytes', () => {
		expect(tableCellWrite.mapOffset('a|b\n', 2, ctx)).toBe(3);
		expect(tableCellWrite.mapOffset('a|b\n', 4, ctx)).toBe(4);
	});
});

// ── The writer against the row splitter ─────────────────────────────────────

// Cell text heavy on what the row splitter reads: pipes, backslash runs, code spans, whitespace.
const arbCellText = fc
	.array(fc.constantFrom('|', '\\', '\\|', '`', '``', 'a', ' ', '\t', '\u00a0', '-'), {
		maxLength: 8
	})
	.map((parts) => parts.join(''));

const cell = (raw: string): CstNode => ({ kind: 'tableCell', leadingTrivia: '', raw });

function tableOf(rows: string[][]): CstNode {
	const table: CstNode = {
		kind: 'table',
		leadingTrivia: '',
		raw: '\n',
		metadata: { columnCount: rows[0].length, alignments: rows[0].map(() => 'none' as const) },
		children: rows.map((cells, i) => ({
			kind: 'tableRow',
			leadingTrivia: '',
			raw: '',
			metadata: { isHeader: i === 0 },
			children: cells.map(cell)
		}))
	};
	rebuildTableRaw(table);
	return table;
}

describe('a table written from cell raws parses back to the same cells', () => {
	it('holds for pipes, backslashes before pipes and code spans holding pipes', () => {
		const arbRows = fc.integer({ min: 1, max: 3 }).chain((width) =>
			fc.array(fc.array(arbCellText, { minLength: width, maxLength: width }), {
				minLength: 1,
				maxLength: 3
			})
		);
		fc.assert(
			fc.property(arbRows, (texts) => {
				const raws = texts.map((row) => row.map(normalizeCellRaw));
				const read = parse(tableOf(raws).raw).children[0];
				expect(read.kind).toBe('table');
				expect(read.children!.map((row) => row.children!.map((c) => c.raw))).toEqual(
					raws.map((row) => row.map(trimWhitespace))
				);
			}),
			{ numRuns: 500, seed: freshOrFixedSeed(41011) }
		);
	});

	it('a code span holding a pipe stays one cell (GFM example 200)', () => {
		const raws = [
			['a', 'b'],
			[normalizeCellRaw('`x|y`'), 'z']
		];
		expect(raws[1][0]).toBe('`x\\|y`');
		const read = parse(tableOf(raws).raw).children[0];
		expect(read.children![1].children!.map((c) => c.raw)).toEqual(['`x\\|y`', 'z']);
	});
});

describe('unescapeCellPipes', () => {
	it('takes one backslash off each escaped pipe', () => {
		expect(unescapeCellPipes('a\\|b')).toBe('a|b');
		expect(unescapeCellPipes('a\\\\\\|b')).toBe('a\\\\|b');
		expect(unescapeCellPipes('a\\b')).toBe('a\\b');
	});

	it('is undone by the cell writer, so a copied cell pastes back to the same bytes', () => {
		fc.assert(
			fc.property(arbCellText.map(normalizeCellRaw), (raw) => {
				expect(normalizeCellRaw(unescapeCellPipes(raw))).toBe(raw);
			}),
			{ numRuns: 500, seed: freshOrFixedSeed(41012) }
		);
	});
});
