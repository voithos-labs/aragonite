/**
 * Blockquote parser with CommonMark §5.1 lazy continuation. "Open paragraph" is
 * approximated per line (non-blank, not a block opener), not tracked as parser state.
 */

import { remapStrippedLines, type ParsedLine } from '../lines';
import { joinRaw, parseBlocks, isBlankLine } from '../parser';
import { INNER_LINE, type LineCodec } from '../strip-lines';
import {
	defaultGrammarView,
	lineInterruptsParagraph,
	lineStartsOuterBlock,
	type BlockOpenerResult,
	type GrammarView
} from '../../schema/block-openers';

export function matchBlockquote(text: string): boolean {
	return /^ {0,3}>/.test(text);
}

const QUOTE_PREFIX = /^ {0,3}>[ \t]?/;

/** A quote line: up to three spaces, `>`, then one optional space or tab; a line with no `>`
 *  is a lazy continuation. */
export const quoteLines: LineCodec = {
	read(line, place) {
		const prefix = QUOTE_PREFIX.exec(line)?.[0];
		if (prefix === undefined) {
			return place.first || isBlankLine(line) ? null : { text: line, prefix: '', lazy: true };
		}
		const text = line.slice(prefix.length);
		// A `>` with nothing between it and the text is a marker the user may still be finishing
		// (`contentStartSpace`), so a rewritten line takes the marker's space.
		const waiting = prefix.endsWith('>') && text !== '' && !text.startsWith('>');
		return { text, prefix: waiting ? null : prefix, lazy: false };
	},
	write: (text) => (text === '' ? '>' : '> ' + text)
};

const stripBlockquotePrefix = (text: string): string => quoteLines.read(text, INNER_LINE)!.text;

/** Lazy continuation extends only an open paragraph, not an open list or other container. */
function wouldKeepParagraphOpen(strippedText: string): boolean {
	if (isBlankLine(strippedText)) return false;
	if (lineInterruptsParagraph(strippedText)) return false;
	if (matchBlockquote(strippedText)) return false;
	return true;
}

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
			paragraphOpen = wouldKeepParagraphOpen(stripped);
			i++;
			continue;
		}
		if (
			paragraphOpen &&
			wouldKeepParagraphOpen(lineText) &&
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
