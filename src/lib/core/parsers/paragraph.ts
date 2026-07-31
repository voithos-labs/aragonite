/**
 * Paragraph fallback. Owns setext-heading and table detection too: both emerge from
 * paragraph continuation (next-line lookahead), not from their own top-level matchers.
 */

import type { ParsedLine } from '../lines';
import { joinRaw, isBlankLine } from '../parser';
import { lineInterruptsParagraph, type BlockOpenerResult } from '../../schema/block-openers';
import { matchTableDelimiterRow, parseTable, splitRowCells } from './table';

export function parseParagraph(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string
): BlockOpenerResult {
	if (startIndex + 1 < endIndex) {
		const delimiter = matchTableDelimiterRow(lines[startIndex + 1].text);
		// GFM §4.10: a header/delimiter count mismatch is no table; accepting it would
		// truncate surplus header cells out of the model.
		if (
			delimiter &&
			lines[startIndex].text.includes('|') &&
			splitRowCells(lines[startIndex].text).length === delimiter.columnCount
		) {
			return parseTable(lines, startIndex, endIndex, leadingTrivia, delimiter);
		}
	}

	let i = startIndex + 1;

	while (i < endIndex && !isBlankLine(lines[i].text) && !lineInterruptsParagraph(lines[i].text)) {
		const setext = matchSetextUnderline(lines[i].text);
		if (setext) {
			const raw = joinRaw(lines, startIndex, i + 1);
			return {
				node: { kind: 'setextHeading', leadingTrivia, raw, metadata: { level: setext.level } },
				consumed: i + 1 - startIndex
			};
		}
		i++;
	}

	const raw = joinRaw(lines, startIndex, i);
	return {
		node: { kind: 'paragraph', leadingTrivia, raw },
		consumed: i - startIndex
	};
}

function matchSetextUnderline(text: string): { level: 1 | 2 } | null {
	if (/^ {0,3}=+\s*$/.test(text)) return { level: 1 };
	if (/^ {0,3}-+\s*$/.test(text)) return { level: 2 };
	return null;
}
