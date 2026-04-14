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
 * when the next line starts a new block. Thematic breaks are deliberately
 * excluded here — a `---` line does NOT interrupt a paragraph from inside
 * the continuation scan; it only gets recognized at the top level of
 * parseNextBlock, with its blank-line guard, so setext heading underlines
 * are not split off as thematic breaks.
 */
export function startsNewBlock(text: string): boolean {
	return Boolean(
		matchFenceOpen(text) || matchHeading(text) || matchBlockquote(text) || matchListItem(text)
	);
}
