/**
 * How one table line reads (its cells and where each sits) and how a row or delimiter line is
 * written. It imports no parser or registry, so the parser, the rebuilders and the menus can use it.
 */

import type { TableAlignment } from '../nodes';
import { isWhitespaceChar, trimWhitespace } from '../lines';

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
	const { lo, hi } = rowEdges(rowText);
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

/** Whether a table line opens on a pipe of its own, as `| a | b` does and `a | b` doesn't. */
export function opensOnPipe(rowText: string): boolean {
	return rowEdges(rowText).leading;
}

/** Whether a line starts and ends with a pipe character, an escaped last one included: how a
 *  pasted line with no delimiter row is taken as a grid row. */
export function wrappedInPipes(rowText: string): boolean {
	const text = trimWhitespace(rowText);
	return text.length >= 2 && text[0] === '|' && text[text.length - 1] === '|';
}

/** Whether the pipe at `index` is a cell boundary rather than escaped text. */
export function boundaryPipeAt(rowText: string, index: number): boolean {
	return rowText[index] === '|' && !endsInEscape(rowText, index);
}

function rowEdges(rowText: string) {
	let lo = 0;
	let hi = rowText.length;
	while (lo < hi && isWhitespaceChar(rowText[lo])) lo++;
	while (hi > lo && isWhitespaceChar(rowText[hi - 1])) hi--;
	const leading = lo < hi && rowText[lo] === '|';
	if (leading) lo++;
	// An escaped last pipe is the last cell's text, as GFM reads it (`|1|x\|` holds `x|`).
	const trailing = hi > lo && rowText[hi - 1] === '|' && !endsInEscape(rowText, hi - 1, lo);
	if (trailing) hi--;
	return { lo, hi, leading, trailing };
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

function paddedCell(text: string): string {
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

// ── Writing over a line ────────────────────────────────────────────────────

export interface CellWrite<T> {
	before: readonly T[];
	after: readonly T[];
	spell: (cell: T) => string;
	/** Trailing empty cells past the line's last one may stay unwritten. */
	mayStayMissing: boolean;
}

/** `after` written over a line whose cells read `before`: cells equal from either end keep their
 *  bytes, those between take new text in their old padding, the rest are cut or added. */
export function spliceCells<T>(text: string, spans: CellSpan[], write: CellWrite<T>): string {
	const { before, after, spell } = write;
	let head = 0;
	while (head < before.length && head < after.length && before[head] === after[head]) head++;
	if (head === before.length && head === after.length) return text;
	let tail = 0;
	while (
		tail < before.length - head &&
		tail < after.length - head &&
		before[before.length - 1 - tail] === after[after.length - 1 - tail]
	) {
		tail++;
	}
	const paired = Math.min(before.length, after.length) - head - tail;
	let addedEnd = after.length - tail;
	if (tail === 0 && write.mayStayMissing) {
		while (addedEnd > head + paired && spell(after[addedEnd - 1]) === '') addedEnd--;
	}
	const region = (i: number) => text.slice(spans[i].from, spans[i].to);
	const pieces: string[] = [];
	for (let i = 0; i < head; i++) pieces.push(region(i));
	for (let i = head; i < head + paired; i++)
		pieces.push(rewriteCell(text, spans[i], spell(after[i])));
	for (let i = head + paired; i < addedEnd; i++) pieces.push(paddedCell(spell(after[i])));
	for (let i = before.length - tail; i < before.length; i++) pieces.push(region(i));
	return text.slice(0, spans[0].from) + pieces.join('|') + text.slice(spans.at(-1)!.to);
}

/** The cell's region with `value` in place of its text; an empty cell's text goes after one
 *  byte of its padding, so `|  |` becomes `| x |`. */
function rewriteCell(text: string, span: CellSpan, value: string): string {
	const { from, start, end, to } = span;
	const at = start < end ? start : Math.min(from + 1, to);
	const after = text.slice(start < end ? end : at, to);
	// A trailing backslash against the next pipe would escape it and join the two cells.
	const gap = after === '' && text[to] === '|' && endsInEscape(value) ? ' ' : '';
	return text.slice(from, at) + value + gap + after;
}
