/**
 * How one table line reads: its cells and where each sits, the parser's split and the one the
 * table rebuild writes back into. It imports no parser or registry, so the rebuilders can use it.
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
	// Escaped or not, a last pipe closes the row, as GFM's own table extension reads it.
	if (hi > lo && rowText[hi - 1] === '|') hi--;
	const cells: CellSpan[] = [];
	let from = lo;
	let escaped = false;
	for (let i = lo; i <= hi; i++) {
		if (i < hi && (rowText[i] !== '|' || escaped)) {
			escaped = rowText[i] === '\\' && !escaped;
			continue;
		}
		let start = from;
		let end = i;
		while (start < end && isWhitespaceChar(rowText[start])) start++;
		while (end > start && isWhitespaceChar(rowText[end - 1])) end--;
		cells.push({ text: rowText.slice(start, end), from, start, end, to: i });
		from = i + 1;
	}
	return cells;
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

/** The alignment one delimiter cell spells, or null when it is no delimiter cell. */
export function delimiterCellAlignment(text: string): TableAlignment | null {
	if (!/^:?-+:?$/.test(text)) return null;
	const left = text.startsWith(':');
	const right = text.endsWith(':');
	if (left && right) return 'center';
	if (left) return 'left';
	return right ? 'right' : 'none';
}
