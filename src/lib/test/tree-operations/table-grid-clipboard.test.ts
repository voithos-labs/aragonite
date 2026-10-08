import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parse } from '$lib/core/parser';
import { normalizeCellRaw } from '$lib/schema/table-cell-raw';
import { copyRectangleAsSubTable } from '$lib/tree-operations/sub-table-copy';
import {
	gridToHtmlTable,
	parseClipboardGrid,
	rectangleGrid,
	tileGridTo
} from '$lib/tree-operations/table-grid-clipboard';
import { freshOrFixedSeed } from '../invariants/arbitraries';

describe('parseClipboardGrid', () => {
	it('reads tab-separated rows, padded to the widest, dropping a trailing newline', () => {
		expect(parseClipboardGrid('a\tb\nc\n')).toEqual([
			['a', 'b'],
			['c', '']
		]);
		expect(parseClipboardGrid('a\tb\r\nc\td\r\n')).toEqual([
			['a', 'b'],
			['c', 'd']
		]);
	});

	it('reads a GFM table, dropping the delimiter row and unescaping pipes', () => {
		expect(parseClipboardGrid('| X | Y |\n| --- | :---: |\n| 9 | a\\|b |\n')).toEqual([
			['X', 'Y'],
			['9', 'a|b']
		]);
	});

	it('a rectangle copy of one row is a header-only table and still a grid', () => {
		expect(parseClipboardGrid('| 1 | 2 |\n| --- | --- |\n')).toEqual([['1', '2']]);
	});

	it('keeps a tab-separated cell’s own spaces and a blank line as an empty row', () => {
		expect(parseClipboardGrid(' a \tb\n\nc\td')).toEqual([
			[' a ', 'b'],
			['', ''],
			['c', 'd']
		]);
		expect(parseClipboardGrid('a\tb\rc\td')).toEqual([
			['a', 'b'],
			['c', 'd']
		]);
		expect(parseClipboardGrid('a\tb')).toEqual([['a', 'b']]);
	});

	it('reads lines that are all pipe rows as GFM even when they hold tabs', () => {
		expect(parseClipboardGrid('|a|\t|b|\n|c|\t|d|')).toEqual([
			['a', '', 'b'],
			['c', '', 'd']
		]);
	});

	// Miss-analysis: the clipboard's tests never put a backslash before a pipe.
	it('splits a GFM row where the table parser does', () => {
		const text = '| a\\\\| b |\n| --- | --- |\n| `x\\|y` | z |\n';
		expect(parseClipboardGrid(text)).toEqual([
			['a\\\\', 'b'],
			['`x|y`', 'z']
		]);
	});

	// Miss-analysis: every GFM fixture here had both edge pipes, the one spelling the hand gate knew.
	it.each([
		['no edge pipes', 'a | b\n--- | ---\n1 | 2\n'],
		['a leading pipe only', '| a | b\n| --- | ---\n| 1 | 2\n'],
		['a trailing pipe only', 'a | b |\n:-- | --: |\n1 | 2 |\n']
	])('reads a table the parser reads, %s', (_, text) => {
		expect(parseClipboardGrid(text)).toEqual([
			['a', 'b'],
			['1', '2']
		]);
	});

	it('a header whose cell count the delimiter does not match is no table, so no grid', () => {
		expect(parseClipboardGrid('a | b\n--- | --- | ---\n1 | 2\n')).toBeNull();
	});

	it('plain text, one word, or lines without tabs are not a grid', () => {
		expect(parseClipboardGrid('hello')).toBeNull();
		expect(parseClipboardGrid('hello\nworld')).toBeNull();
		expect(parseClipboardGrid('')).toBeNull();
		expect(parseClipboardGrid('a|b|c')).toBeNull();
	});
});

describe('a copied rectangle pasted back', () => {
	const arbCellRaw = fc
		.array(fc.constantFrom('|', '\\', '\\|', '`', 'a', ' ', '-'), { minLength: 1, maxLength: 6 })
		.map((parts) => normalizeCellRaw(parts.join('')).trim() || 'x');

	it('reads as the grid the copy wrote to the spreadsheet formats', () => {
		const arbTable = fc.integer({ min: 2, max: 3 }).chain((width) =>
			fc.array(fc.array(arbCellRaw, { minLength: width, maxLength: width }), {
				minLength: 2,
				maxLength: 3
			})
		);
		fc.assert(
			fc.property(arbTable, (rows) => {
				const width = rows[0].length;
				const lines = rows.map((cells) => `| ${cells.join(' | ')} |\n`);
				const source = lines[0] + `|${' --- |'.repeat(width)}\n` + lines.slice(1).join('');
				const table = parse(source).children[0];
				const corner = { rowIdx: rows.length - 1, colIdx: width - 1 };
				const copied = copyRectangleAsSubTable(table, { rowIdx: 0, colIdx: 0 }, corner);
				expect(parseClipboardGrid(copied)).toEqual(
					rectangleGrid(table, { rowIdx: 0, colIdx: 0 }, corner)
				);
			}),
			{ numRuns: 300, seed: freshOrFixedSeed(41013) }
		);
	});
});

describe('tileGridTo', () => {
	it('tiles when the rectangle is a multiple of the grid, else leaves it', () => {
		expect(tileGridTo([['x', 'y']], 2, 2)).toEqual([
			['x', 'y'],
			['x', 'y']
		]);
		expect(tileGridTo([['x', 'y']], 2, 3)).toEqual([['x', 'y']]);
		expect(tileGridTo([['x']], 1, 1)).toEqual([['x']]);
	});
});

describe('gridToHtmlTable', () => {
	it('writes one td per cell with markup escaped', () => {
		expect(gridToHtmlTable([['a<b', '&']])).toBe(
			'<table><tr><td>a&lt;b</td><td>&amp;</td></tr></table>'
		);
	});
});
