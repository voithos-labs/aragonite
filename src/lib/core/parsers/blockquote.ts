/**
 * Blockquote parser with CommonMark §5.1 lazy continuation. "Open paragraph" is
 * approximated per line (non-blank, not a block opener), not tracked as parser state.
 */

import type { ParsedLine } from '../lines';
import { joinRaw } from '../parser';
import { codecFromShape, INNER_LINE, keepsParagraphOpen, type MarkedLines } from '../strip-lines';
import {
	lineStartsOuterBlock,
	type BlockOpener,
	type GrammarView
} from '../../schema/block-openers';
import { stripOpener } from './strip-container';
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

/** The quote's opener: its lines read as any marked container's are, the `>` count of its first
 *  line kept as its depth. */
export function quoteOpener(priority: number): BlockOpener {
	// Made at the first read: this module sits on the parser's import cycle.
	let reader: BlockOpener | undefined;
	return {
		priority,
		interruptsParagraph: matchBlockquote,
		tryOpen(ctx) {
			reader ??= stripOpener('blockquote', QUOTE_LINES, priority, true);
			const opened = reader.tryOpen(ctx);
			const markers = QUOTE_MARKERS.exec(ctx.line.text)?.[0] ?? '';
			if (opened) opened.node.metadata = { quoteDepth: markers.split('>').length - 1 };
			return opened;
		}
	};
}

const QUOTE_MARKERS = /^ {0,3}(?:>[ \t]?)+/;
