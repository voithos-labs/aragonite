/**
 * Paragraph parser — the fallback for any line that doesn't match a more
 * specific block opener. Also owns setext heading detection (when the next
 * line is `===` or `---` underline) and table detection (when the second line
 * is a delimiter row). These emerge from inside paragraph parsing rather than
 * having their own top-level matchers, which is why they live here.
 */

import type { CstNode } from '../nodes';
import type { ParsedLine } from '../lines';
import { joinRaw, isBlankLine } from '../parser';
import { matchFenceOpen } from './fenced-code';
import { matchHeading } from './heading';
import { matchBlockquote } from './blockquote';
import { matchListItem } from './list';
import { matchThematicBreak } from './thematic-break';

export function parseParagraph(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string
): { node: CstNode; nextIndex: number } {
	// Check for table: first line has a pipe and second line is a delimiter row
	if (startIndex + 1 < endIndex) {
		const delimiter = matchTableDelimiterRow(lines[startIndex + 1].text);
		if (delimiter && lines[startIndex].text.includes('|')) {
			return parseTable(lines, startIndex, endIndex, leadingTrivia, delimiter.columnCount);
		}
	}

	let i = startIndex + 1;

	while (i < endIndex && !isBlankLine(lines[i].text) && !startsNewBlock(lines[i].text)) {
		// Check if this line is a setext underline for the paragraph above
		const setext = matchSetextUnderline(lines[i].text);
		if (setext) {
			const raw = joinRaw(lines, startIndex, i + 1);
			return {
				node: { kind: 'setextHeading', leadingTrivia, raw, metadata: { level: setext.level } },
				nextIndex: i + 1
			};
		}
		i++;
	}

	const raw = joinRaw(lines, startIndex, i);
	return {
		node: { kind: 'paragraph', leadingTrivia, raw },
		nextIndex: i
	};
}

function matchSetextUnderline(text: string): { level: 1 | 2 } | null {
	if (/^ {0,3}=+\s*$/.test(text)) return { level: 1 };
	if (/^ {0,3}-+\s*$/.test(text)) return { level: 2 };
	return null;
}

function matchTableDelimiterRow(text: string): { columnCount: number } | null {
	const trimmed = text.trim();
	if (!trimmed.includes('|')) return null;

	const inner = trimmed.replace(/^\||\|$/g, '');
	const cells = inner.split('|');

	for (const cell of cells) {
		if (!/^\s*:?-+:?\s*$/.test(cell)) return null;
	}

	return { columnCount: cells.length };
}

function parseTable(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string,
	columnCount: number
): { node: CstNode; nextIndex: number } {
	// Header row + delimiter row already confirmed, consume data rows
	let i = startIndex + 2;

	while (i < endIndex && !isBlankLine(lines[i].text) && lines[i].text.includes('|')) {
		i++;
	}

	const raw = joinRaw(lines, startIndex, i);
	return {
		node: { kind: 'table', leadingTrivia, raw, metadata: { columnCount } },
		nextIndex: i
	};
}

/**
 * Continuation-scan interruption check. A paragraph stops absorbing lines
 * when the next line starts a new block.
 *
 * Thematic breaks here are restricted to `***` and `___` — `---` is
 * deliberately excluded because it is ambiguous with a setext level-2
 * underline, and the setext check in the paragraph-continuation loop has
 * first claim on it. `***` and `___` have no such ambiguity and must
 * interrupt per CommonMark §4.8.
 */
export function startsNewBlock(text: string): boolean {
	if (matchFenceOpen(text)) return true;
	if (matchHeading(text)) return true;
	if (matchBlockquote(text)) return true;
	if (matchListItem(text)) return true;
	const tb = matchThematicBreak(text);
	if (tb === '*' || tb === '_') return true;
	return false;
}
