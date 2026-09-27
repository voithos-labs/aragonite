/**
 * The grid a clipboard payload holds, for a spreadsheet-like paste into a table: tab-separated
 * rows (what Excel and Sheets write to text/plain) or a GFM table (what this editor's own
 * rectangle copy writes). Anything else is not a grid and takes the ordinary paste route. The
 * inverse, an HTML table for the spreadsheets that read text/html, lives here too.
 */

import type { NodeView } from '../core/node-views';
import { isBlankText, trimWhitespace } from '../core/lines';
import { matchTableDelimiterRow, splitRowCells } from '../core/parsers/table';
import { unescapeCellPipes } from '../schema/table-cell-raw';
import { rectangleCellRaws, type CellPos } from './sub-table-copy';

/** Rows of cell texts, rectangular: every row padded to the widest. Null for a non-grid payload. */
export function parseClipboardGrid(text: string): string[][] | null {
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	while (lines.length && isBlankText(lines[lines.length - 1])) lines.pop();
	if (lines.length === 0) return null;
	const rows = parseGfmRows(lines) ?? parseTsvRows(lines);
	if (!rows || rows.length === 0) return null;
	let width = 0;
	for (const row of rows) width = Math.max(width, row.length);
	if (width < 2 && rows.length < 2) return null;
	return rows.map((row) => [...row, ...Array<string>(width - row.length).fill('')]);
}

// Every line a pipe row, split and its delimiter line recognized by the table parser itself;
// a cell's pipes are unescaped, as a copied rectangle's are.
function parseGfmRows(lines: string[]): string[][] | null {
	if (!lines.every((line) => /^\|.*\|$/.test(trimWhitespace(line)))) return null;
	const rows = lines.map((line) => splitRowCells(line).map(unescapeCellPipes));
	if (rows.length >= 2 && matchTableDelimiterRow(lines[1])) rows.splice(1, 1);
	return rows;
}

function parseTsvRows(lines: string[]): string[][] | null {
	if (!lines.some((line) => line.includes('\t'))) return null;
	return lines.map((line) => line.split('\t'));
}

/** A rectangle's cell texts, pipes unescaped, as the clipboard's grid. */
export function rectangleGrid(table: NodeView, a: CellPos, b: CellPos): string[][] {
	return rectangleCellRaws(table, a, b).map((row) => row.map(unescapeCellPipes));
}

/** The grid repeated to fill a selection whose sides are multiples of it (a spreadsheet's
 *  tiling); any other selection takes the grid once from its top-left corner. */
export function tileGridTo(grid: string[][], rows: number, cols: number): string[][] {
	const height = grid.length;
	const width = grid[0]?.length ?? 0;
	if (height === 0 || width === 0) return grid;
	if (rows % height !== 0 || cols % width !== 0 || (rows === height && cols === width)) {
		return grid;
	}
	return Array.from({ length: rows }, (_, r) =>
		Array.from({ length: cols }, (_, c) => grid[r % height][c % width])
	);
}

export function gridToHtmlTable(grid: string[][]): string {
	const escape = (text: string) =>
		text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const rows = grid
		.map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join('')}</tr>`)
		.join('');
	return `<table>${rows}</table>`;
}
