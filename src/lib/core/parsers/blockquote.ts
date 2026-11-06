/**
 * Blockquote parser with CommonMark §5.1 lazy continuation. "Open paragraph" is
 * approximated per line (non-blank, not a block opener), not tracked as parser state.
 */

import { remapStrippedLines, type ParsedLine } from '../lines';
import { joinRaw, parseBlocks } from '../parser';
import { codecFromShape, INNER_LINE, keepsParagraphOpen, type MarkedLines } from '../strip-lines';
import {
	lineStartsOuterBlock,
	type BlockOpenerResult,
	type GrammarView
} from '../../schema/block-openers';
import { defaultGrammarView } from '../../schema/editor-grammar';

export function matchBlockquote(text: string): boolean {
	return /^ {0,3}>/.test(text);
}

const QUOTE_PREFIX = /^ {0,3}>[ \t]?/;

/** The quote's lines: `>` after up to three spaces, then one optional space or tab. */
export const QUOTE_LINES: MarkedLines = {
	shape: 'marked',
	first: '> ',
	rest: '> ',
	reads: QUOTE_PREFIX,
	lazy: true
};

const quoteLines = codecFromShape(QUOTE_LINES);

const stripBlockquotePrefix = (text: string): string => quoteLines.read(text, INNER_LINE)!.text;

/** Lazy continuation extends only an open paragraph, not an open list or other container. */
const wouldKeepParagraphOpen = (strippedText: string, grammar: GrammarView): boolean =>
	keepsParagraphOpen(QUOTE_LINES, strippedText, grammar);

/** Byte-exact `raw` of a blockquote's extent plus the index past it, with no child decomposition,
 *  for an opener that decomposes its own body (`> [!NOTE]`). The grammar defaults to every plugin. */
export function blockquoteExtent(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	grammar: GrammarView = defaultGrammarView
): { raw: string; nextIndex: number } {
	let i = startIndex;
	let paragraphOpen = false;
	while (i < endIndex) {
		const lineText = lines[i].text;
		if (matchBlockquote(lineText)) {
			const stripped = stripBlockquotePrefix(lineText);
			paragraphOpen = wouldKeepParagraphOpen(stripped, grammar);
			i++;
			continue;
		}
		if (
			paragraphOpen &&
			wouldKeepParagraphOpen(lineText, grammar) &&
			!lineStartsOuterBlock(lines[i], { paragraphOpen: true, grammar })
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
	grammar: GrammarView,
	depth: number = 0,
	isDocumentParse: boolean = false
): BlockOpenerResult {
	const { raw, nextIndex: i } = blockquoteExtent(lines, startIndex, endIndex, grammar);

	// Lazy lines have no `> ` to strip; verbatim keeps the recursive parse seeing one paragraph.
	const strippedLines = remapStrippedLines(lines.slice(startIndex, i), (line) =>
		matchBlockquote(line.text) ? stripBlockquotePrefix(line.text) : line.text
	);

	const inner = parseBlocks(strippedLines, 0, strippedLines.length, {
		grammar,
		scope: isDocumentParse ? 'document' : 'fragment',
		depth: depth + 1
	});

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
