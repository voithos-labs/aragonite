/**
 * Blockquote parser with CommonMark §5.1 lazy continuation: plain non-`>`
 * lines are absorbed while the inner block is an open paragraph. "Open
 * paragraph" is approximated per-line (non-blank + doesn't start a new
 * block) rather than by tracking full block-parser state.
 */

import type { CstNode } from '../nodes';
import { remapStrippedLines, type ParsedLine } from '../lines';
import { joinRaw, parseBlocks, isBlankLine } from '../parser';
import { defaultGrammarView, lineInterruptsParagraph } from '../../schema/block-openers';

export function matchBlockquote(text: string): boolean {
	return /^ {0,3}>/.test(text);
}

function stripBlockquotePrefix(text: string): string {
	return text.replace(/^ {0,3}>[ \t]?/, '');
}

/**
 * Lazy continuation only extends an open paragraph — not an open list or
 * other container. Blank lines, block openers, and nested blockquotes all
 * close the open-paragraph state.
 */
function wouldKeepParagraphOpen(strippedText: string): boolean {
	if (isBlankLine(strippedText)) return false;
	if (lineInterruptsParagraph(strippedText)) return false;
	if (matchBlockquote(strippedText)) return false;
	return true;
}

/**
 * Scan a blockquote's extent (CommonMark §5.1 lazy continuation) and return its
 * byte-exact `raw` plus the index past it — no child decomposition. The narrow
 * shape a blockquote-shaped opener needs when it decomposes its own body
 * (`> [!NOTE]` GitHub alerts strip the marker line before parsing children).
 */
export function blockquoteExtent(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number
): { raw: string; nextIndex: number } {
	let i = startIndex;
	let paragraphOpen = false;
	while (i < endIndex) {
		const lineText = lines[i].text;
		if (matchBlockquote(lineText)) {
			const stripped = stripBlockquotePrefix(lineText);
			paragraphOpen = wouldKeepParagraphOpen(stripped);
			i++;
			continue;
		}
		if (paragraphOpen && wouldKeepParagraphOpen(lineText)) {
			i++;
			continue;
		}
		break;
	}
	return { raw: joinRaw(lines, startIndex, i), nextIndex: i };
}

export function parseBlockquote(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string,
	depth: number = 0
): { node: CstNode; nextIndex: number } {
	const { raw, nextIndex: i } = blockquoteExtent(lines, startIndex, endIndex);

	// Lazy continuation lines have no `> ` to strip — pass them verbatim so
	// the recursive paragraph parser sees a continuous multi-line paragraph.
	const strippedLines = remapStrippedLines(lines.slice(startIndex, i), (line) =>
		matchBlockquote(line.text) ? stripBlockquotePrefix(line.text) : line.text
	);

	const inner = parseBlocks(strippedLines, 0, strippedLines.length, defaultGrammarView, depth + 1);

	const quotePrefix = lines[startIndex].text.match(/^ {0,3}(>[ \t]?)+/)?.[0] ?? '';
	const quoteDepth = (quotePrefix.match(/>/g) ?? []).length || 1;

	return {
		node: {
			kind: 'blockquote',
			leadingTrivia,
			raw,
			metadata: { quoteDepth },
			innerPrefix: inner.prefix,
			children: inner.children,
			innerSuffix: inner.suffix
		},
		nextIndex: i
	};
}
