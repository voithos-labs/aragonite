/**
 * Paragraph fallback. Owns setext-heading and table detection too: both emerge from
 * paragraph continuation (next-line lookahead), not from their own top-level matchers.
 */

import { OPTIONAL_LINE_ENDING, type ParsedLine } from '../lines';
import { joinRaw, isBlankLine } from '../parser';
import {
	lineInterruptsParagraph,
	type BlockOpenerResult,
	type GrammarView
} from '../../schema/block-openers';
import { matchTableOpening, parseTable } from './table';
import { matchThematicBreak } from './thematic-break';

export function parseParagraph(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string,
	grammar: GrammarView
): BlockOpenerResult {
	if (startIndex + 1 < endIndex) {
		const delimiter = matchTableOpening(lines[startIndex].text, lines[startIndex + 1].text);
		if (delimiter) {
			return parseTable(lines, startIndex, endIndex, leadingTrivia, delimiter, grammar);
		}
	}

	let i = startIndex + 1;

	while (i < endIndex && !isBlankLine(lines[i].text) && !lineInterruptsParagraph(lines[i].text)) {
		const setext = matchSetextUnderline(lines[i].text);
		// With setext headings off, `---` is the thematic break GFM reads once setext is out.
		if (setext && !grammar.setextHeading) {
			if (matchThematicBreak(lines[i].text)) break;
		} else if (setext) {
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

const SETEXT_1 = new RegExp(`^ {0,3}=+[ \\t]*${OPTIONAL_LINE_ENDING}$`);
const SETEXT_2 = new RegExp(`^ {0,3}-+[ \\t]*${OPTIONAL_LINE_ENDING}$`);

export function matchSetextUnderline(text: string): { level: 1 | 2 } | null {
	if (SETEXT_1.test(text)) return { level: 1 };
	if (SETEXT_2.test(text)) return { level: 2 };
	return null;
}
