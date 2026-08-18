/**
 * Blockquote parser with CommonMark §5.1 lazy continuation. "Open paragraph" is
 * approximated per line (non-blank, not a block opener), not tracked as parser state.
 */

import { remapStrippedLines, type ParsedLine } from '../lines';
import { joinRaw, parseBlocks, isBlankLine } from '../parser';
import {
	defaultGrammarView,
	lineInterruptsParagraph,
	lineStartsOuterBlock,
	type BlockOpenerResult
} from '../../schema/block-openers';

export function matchBlockquote(text: string): boolean {
	return /^ {0,3}>/.test(text);
}

function stripBlockquotePrefix(text: string): string {
	return text.replace(/^ {0,3}>[ \t]?/, '');
}

/** Lazy continuation extends only an open paragraph, not an open list or other container. */
function wouldKeepParagraphOpen(strippedText: string): boolean {
	if (isBlankLine(strippedText)) return false;
	if (lineInterruptsParagraph(strippedText)) return false;
	if (matchBlockquote(strippedText)) return false;
	return true;
}

/**
 * Byte-exact `raw` of a blockquote's extent (CommonMark §5.1 lazy continuation) plus the
 * index past it, no child decomposition: what a blockquote-shaped opener needs when it
 * decomposes its own body (`> [!NOTE]` alerts strip the marker line before parsing children).
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
		if (
			paragraphOpen &&
			wouldKeepParagraphOpen(lineText) &&
			!lineStartsOuterBlock(lines[i], { paragraphOpen: true })
		) {
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
	depth: number = 0,
	isDocumentParse: boolean = false
): BlockOpenerResult {
	const { raw, nextIndex: i } = blockquoteExtent(lines, startIndex, endIndex);

	// Lazy lines have no `> ` to strip; verbatim keeps the recursive parse seeing one paragraph.
	const strippedLines = remapStrippedLines(lines.slice(startIndex, i), (line) =>
		matchBlockquote(line.text) ? stripBlockquotePrefix(line.text) : line.text
	);

	const inner = parseBlocks(
		strippedLines,
		0,
		strippedLines.length,
		defaultGrammarView,
		depth + 1,
		isDocumentParse
	);

	const quotePrefix = lines[startIndex].text.match(/^ {0,3}(>[ \t]?)+/)![0];
	const quoteDepth = quotePrefix.match(/>/g)!.length;

	return {
		node: {
			kind: 'blockquote',
			leadingTrivia,
			raw,
			metadata: { quoteDepth },
			innerPrefix: '',
			children: inner.children,
			innerSuffix: inner.suffix
		},
		consumed: i - startIndex
	};
}
