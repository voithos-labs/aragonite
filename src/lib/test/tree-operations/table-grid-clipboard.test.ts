import { describe, expect, it } from 'vitest';
import {
	gridToHtmlTable,
	parseClipboardGrid,
	tileGridTo
} from '$lib/tree-operations/table-grid-clipboard';

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

	it('plain text, one word, or lines without tabs are not a grid', () => {
		expect(parseClipboardGrid('hello')).toBeNull();
		expect(parseClipboardGrid('hello\nworld')).toBeNull();
		expect(parseClipboardGrid('')).toBeNull();
		expect(parseClipboardGrid('a|b|c')).toBeNull();
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
