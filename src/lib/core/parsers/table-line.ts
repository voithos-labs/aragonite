/**
 * How one table line reads (its cells and where each sits) and how a row or delimiter line is
 * written. It imports no parser or registry, so the parser, the rebuilders and the menus can use it.
 */

import type { TableAlignment } from '../nodes';
import { isWhitespaceChar } from '../lines';

// ── Cell splitter ──────────────────────────────────────────────────────────

/**
 * One cell of a table line: its text, trimmed as GFM §4.10 trims it, at `start`..`end`, inside the
 * region `from`..`to` between its two pipes (or a line edge). A non-breaking space is content.
 */
export interface CellSpan {
	text: string;
	from: number;
	start: number;
	end: number;
	to: number;
}

/** A table line's cells in order; one pipe sits between each region and the next, and the bytes
 *  before the first region and after the last are the line's own. */
export function rowCellSpans(rowText: string): CellSpan[] {
	let lo = 0;
	let hi = rowText.length;
	while (lo < hi && isWhitespaceChar(rowText[lo])) lo++;
	while (hi > lo && isWhitespaceChar(rowText[hi - 1])) hi--;
	if (lo < hi && rowText[lo] === '|') lo++;
	// An escaped last pipe is the last cell's text, as GFM reads it (`|1|x\|` holds `x|`).
	if (hi > lo && rowText[hi - 1] === '|' && !endsInEscape(rowText, hi - 1, lo)) hi--;
	const cells: CellSpan[] = [];
	let from = lo;
	let escaped = false;
	for (let i = lo; i <= hi; i++) {
		if (i < hi && (rowText[i] !== '|' || escaped)) {
			escaped = rowText[i] === '\\' && !escaped;
			continue;
		}
		const [start, end] = contentBounds(rowText, from, i);
		cells.push({ text: rowText.slice(start, end), from, start, end, to: i });
		from = i + 1;
	}
	return cells;
}

/** A cell's text as its row reads it: a cell's edge whitespace is padding, whatever wrote it. */
export function cellText(raw: string): string {
	const [start, end] = contentBounds(raw, 0, raw.length);
	return start === 0 && end === raw.length ? raw : raw.slice(start, end);
}

function contentBounds(text: string, from: number, to: number): [number, number] {
	let start = from;
	let end = to;
	while (start < end && isWhitespaceChar(text[start])) start++;
	while (end > start && isWhitespaceChar(text[end - 1])) end--;
	return [start, end];
}

/** Whether `text` before `end` ends in an odd run of backslashes, which escapes a pipe at `end`;
 *  the run stops at `start`. */
export function endsInEscape(text: string, end = text.length, start = 0): boolean {
	let i = end;
	while (i > start && text[i - 1] === '\\') i--;
	return (end - i) % 2 === 1;
}

export function splitRowCells(rowText: string): string[] {
	return rowCellSpans(rowText).map((cell) => cell.text);
}

// ── Delimiter row ──────────────────────────────────────────────────────────

export function matchTableDelimiterRow(
	text: string
): { columnCount: number; alignments: TableAlignment[] } | null {
	if (!text.includes('|')) return null;
	const alignments: TableAlignment[] = [];
	for (const cell of rowCellSpans(text)) {
		const alignment = delimiterCellAlignment(cell.text);
		if (alignment === null) return null;
		alignments.push(alignment);
	}
	return { columnCount: alignments.length, alignments };
}

/** The alignment one delimiter cell spells, or null when it is no delimiter cell;
 *  `delimiterCellSpelling` writes it. */
export function delimiterCellAlignment(text: string): TableAlignment | null {
	if (!/^:?-+:?$/.test(text)) return null;
	const left = text.startsWith(':');
	const right = text.endsWith(':');
	if (left && right) return 'center';
	if (left) return 'left';
	return right ? 'right' : 'none';
}

// ── Writing a line ─────────────────────────────────────────────────────────

/** A row's line in the padded spelling, `| a | b |`, each cell's text as given. */
export function tableRowLine(cells: readonly string[]): string {
	return '|' + cells.map(paddedCell).join('|') + '|';
}

/** The delimiter line for `alignments`, in the row's padded spelling: `| --- | :---: |`. */
export function tableDelimiterLine(alignments: readonly TableAlignment[]): string {
	return tableRowLine(alignments.map(delimiterCellSpelling));
}

/** A new table's lines: the header, a delimiter with no alignment, and `bodyRows` empty rows. */
export function newTableLines(header: readonly string[], bodyRows: number): string[] {
	const empty = tableRowLine(header.map(() => ''));
	return [
		tableRowLine(header),
		tableDelimiterLine(header.map(() => 'none')),
		...Array<string>(bodyRows).fill(empty)
	];
}

/** A cell's text as it sits between two pipes: one space of padding on each side. */
export function paddedCell(text: string): string {
	return ` ${text} `;
}

export function delimiterCellSpelling(alignment: TableAlignment): string {
	switch (alignment) {
		case 'left':
			return ':---';
		case 'center':
			return ':---:';
		case 'right':
			return '---:';
		case 'none':
			return '---';
		default: {
			const _exhaustive: never = alignment;
			throw new Error(`Unknown alignment: ${_exhaustive}`);
		}
	}
}
