import type { CstNode, TableAlignment } from '../nodes';
import type { ParsedLine } from '../lines';
import { joinRaw, isBlankLine } from '../parser';
import type { BlockOpenerResult } from '../../schema/block-openers';

// ── Cell splitter ──────────────────────────────────────────────────────────

// Cell padding is cosmetic. Pre-edit bytes survive in `table.raw`; post-edit,
// rebuildTableRowRaw emits canonical single-space padding for every row.
export function splitRowCells(rowText: string): string[] {
	const trimmed = rowText.trim();
	const head = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
	const inner = head.endsWith('|') ? head.slice(0, -1) : head;
	const cells: string[] = [];
	let current = '';
	let i = 0;
	while (i < inner.length) {
		const ch = inner[i];
		if (ch === '|' && !isEscaped(inner, i)) {
			cells.push(current.trim());
			current = '';
			i++;
			continue;
		}
		current += ch;
		i++;
	}
	cells.push(current.trim());
	return cells;
}

function isEscaped(s: string, index: number): boolean {
	let backslashes = 0;
	let j = index - 1;
	while (j >= 0 && s[j] === '\\') {
		backslashes++;
		j--;
	}
	return backslashes % 2 === 1;
}

// ── Delimiter row ──────────────────────────────────────────────────────────

export function matchTableDelimiterRow(
	text: string
): { columnCount: number; alignments: TableAlignment[] } | null {
	const trimmed = text.trim();
	if (!trimmed.includes('|')) return null;

	const inner = trimmed.replace(/^\||\|$/g, '');
	const cells = inner.split('|');
	const alignments: TableAlignment[] = [];

	for (const cell of cells) {
		const c = cell.trim();
		if (!/^:?-+:?$/.test(c)) return null;
		const left = c.startsWith(':');
		const right = c.endsWith(':');
		if (left && right) alignments.push('center');
		else if (left) alignments.push('left');
		else if (right) alignments.push('right');
		else alignments.push('none');
	}

	return { columnCount: cells.length, alignments };
}

// ── Block parser ───────────────────────────────────────────────────────────

export function parseTable(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string,
	delimiter: { columnCount: number; alignments: TableAlignment[] }
): BlockOpenerResult {
	let i = startIndex + 2;
	while (i < endIndex && !isBlankLine(lines[i].text) && lines[i].text.includes('|')) {
		i++;
	}

	const rows: CstNode[] = [];
	rows.push(buildRow(lines[startIndex], delimiter.columnCount, true));
	for (let r = startIndex + 2; r < i; r++) {
		rows.push(buildRow(lines[r], delimiter.columnCount, false));
	}

	const raw = joinRaw(lines, startIndex, i);
	return {
		node: {
			kind: 'table',
			leadingTrivia,
			raw,
			metadata: { columnCount: delimiter.columnCount, alignments: delimiter.alignments },
			children: rows
		},
		consumed: i - startIndex
	};
}

// GFM pads short BODY rows and truncates long ones to the delimiter column count. The header
// always matches: a mismatch rejects the whole table at recognition (GFM §4.10, paragraph.ts).
function buildRow(line: ParsedLine, columnCount: number, isHeader: boolean): CstNode {
	const cellTexts = splitRowCells(line.text);
	while (cellTexts.length < columnCount) cellTexts.push('');
	if (cellTexts.length > columnCount) cellTexts.length = columnCount;
	const cells: CstNode[] = cellTexts.map((text) => ({
		kind: 'tableCell',
		leadingTrivia: '',
		raw: text
	}));
	return {
		kind: 'tableRow',
		leadingTrivia: '',
		raw: line.raw,
		metadata: { isHeader },
		children: cells
	};
}
