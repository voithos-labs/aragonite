/**
 * Paragraph fallback. Also owns setext heading and table detection — both
 * emerge from paragraph continuation (next-line lookahead) rather than
 * having their own top-level matchers.
 */

import type { CstNode } from '../nodes';
import type { ParsedLine } from '../lines';
import { joinRaw, isBlankLine } from '../parser';
import { matchFenceOpen } from './fenced-code';
import { matchHeading } from './heading';
import { matchBlockquote } from './blockquote';
import { canInterruptParagraph as htmlCanInterruptParagraph } from './html-block';
import { canInterruptParagraph } from './list';
import { matchThematicBreak } from './thematic-break';
import { matchTableDelimiterRow, parseTable } from './table';

export function parseParagraph(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string
): { node: CstNode; nextIndex: number } {
	if (startIndex + 1 < endIndex) {
		const delimiter = matchTableDelimiterRow(lines[startIndex + 1].text);
		if (delimiter && lines[startIndex].text.includes('|')) {
			return parseTable(lines, startIndex, endIndex, leadingTrivia, delimiter);
		}
	}

	let i = startIndex + 1;

	while (i < endIndex && !isBlankLine(lines[i].text) && !startsNewBlock(lines[i].text)) {
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

/**
 * Paragraph-interrupt check. Thematic breaks are restricted to `***` and
 * `___` — `---` is ambiguous with a setext L2 underline, and the setext
 * branch above has first claim on it.
 */
export function startsNewBlock(text: string): boolean {
	if (matchFenceOpen(text)) return true;
	if (matchHeading(text)) return true;
	if (matchBlockquote(text)) return true;
	if (canInterruptParagraph(text)) return true;
	if (htmlCanInterruptParagraph(text)) return true;
	const tb = matchThematicBreak(text);
	if (tb === '*' || tb === '_') return true;
	return false;
}
