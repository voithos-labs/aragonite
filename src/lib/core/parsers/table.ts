import type { CstNode, TableAlignment } from '../nodes';
import type { ParsedLine } from '../lines';
import { joinRaw, isBlankLine } from '../parser';
import {
	lineStartsOuterBlock,
	type BlockOpenerResult,
	type GrammarView
} from '../../schema/block-openers';
import { matchTableDelimiterRow, splitRowCells } from './table-line';

// ── Header row ─────────────────────────────────────────────────────────────

/** The cells a line offers as a header row, or null: the one definition, so the continuation scan
 *  and the Enter completer cannot disagree. Arity against the delimiter is the caller's check. */
export function tableHeaderCells(text: string): string[] | null {
	if (!text.includes('|')) return null;
	return splitRowCells(text);
}

/** The delimiter that makes the two lines open a table, or null: GFM §4.10 needs a delimiter line
 *  with the header's cell count. */
export function matchTableOpening(
	headerText: string,
	delimiterText: string
): ReturnType<typeof matchTableDelimiterRow> {
	const delimiter = matchTableDelimiterRow(delimiterText);
	const header = tableHeaderCells(headerText);
	return delimiter && header && header.length === delimiter.columnCount ? delimiter : null;
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
