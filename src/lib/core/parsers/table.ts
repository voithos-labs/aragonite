import type { CstNode, TableAlignment } from '../nodes';
import { trimWhitespace, type ParsedLine } from '../lines';
import { joinRaw, isBlankLine } from '../parser';
import {
	lineStartsOuterBlock,
	type BlockOpenerResult,
	type GrammarView
} from '../../schema/block-openers';

// ── Cell splitter ──────────────────────────────────────────────────────────

// Cell padding is cosmetic: a rebuilt row writes single spaces. GFM §4.10 trims spaces, so a
// non-breaking space at a cell's edge is content and survives the rebuild.
export function splitRowCells(rowText: string): string[] {
	const trimmed = trimWhitespace(rowText);
	const head = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
	const inner = head.endsWith('|') ? head.slice(0, -1) : head;
	const cells: string[] = [];
	let current = '';
	let escaped = false;
	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i];
		if (ch === '|' && !escaped) {
			cells.push(trimWhitespace(current));
			current = '';
			continue;
		}
		current += ch;
		escaped = ch === '\\' && !escaped;
	}
	cells.push(trimWhitespace(current));
	return cells;
}

/** The cells a line offers as a header row, or null: the one definition, so the continuation scan
 *  and the Enter completer cannot disagree. Arity against the delimiter is the caller's check. */
export function tableHeaderCells(text: string): string[] | null {
	if (!text.includes('|')) return null;
	return splitRowCells(text);
}

// ── Delimiter row ──────────────────────────────────────────────────────────

export function matchTableDelimiterRow(
	text: string
): { columnCount: number; alignments: TableAlignment[] } | null {
	const trimmed = trimWhitespace(text);
	if (!trimmed.includes('|')) return null;

	const inner = trimmed.replace(/^\||\|$/g, '');
	const cells = inner.split('|');
	const alignments: TableAlignment[] = [];

	for (const cell of cells) {
		const c = trimWhitespace(cell);
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

/** Whether a table takes `lines[index]` as one more row, pipe or none: GFM ends a table only at a
 *  blank line or a block start (spec example 201), judged in the editor's grammar. */
export function tableTakesLine(
	lines: ParsedLine[],
	index: number,
	end: number,
	grammar: GrammarView
): boolean {
	const line = lines[index];
	return (
		!isBlankLine(line.text) &&
		!lineStartsOuterBlock(line, { paragraphOpen: false, grammar, window: { lines, index, end } })
	);
}

export function parseTable(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string,
	delimiter: { columnCount: number; alignments: TableAlignment[] },
	grammar: GrammarView
): BlockOpenerResult {
	let i = startIndex + 2;
	while (i < endIndex && tableTakesLine(lines, i, endIndex, grammar)) i++;

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

// GFM pads short body rows and renders a long one's first cells, keeping the rest as surplus bytes;
// a header mismatch rejects the whole table at recognition (paragraph.ts).
function buildRow(line: ParsedLine, columnCount: number, isHeader: boolean): CstNode {
	const cellTexts = splitRowCells(line.text);
	while (cellTexts.length < columnCount) cellTexts.push('');
	const surplusCells = cellTexts.splice(columnCount);
	const cells: CstNode[] = cellTexts.map((text) => ({
		kind: 'tableCell',
		leadingTrivia: '',
		raw: text
	}));
	return {
		kind: 'tableRow',
		leadingTrivia: '',
		raw: line.raw,
		metadata: surplusCells.length > 0 ? { isHeader, surplusCells } : { isHeader },
		children: cells
	};
}
