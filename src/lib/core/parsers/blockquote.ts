/**
 * Blockquote parser. Collects continuation lines with `> ` prefixes, strips
 * them, and recursively parses the stripped content.
 *
 * Also implements CommonMark §5.1 lazy continuation: after collecting
 * `>`-prefixed lines, peek at plain non-`>` lines and absorb them if the
 * blockquote's current inner state is an open paragraph. "Open paragraph"
 * here is approximated as "the previously collected stripped line is
 * non-blank and does not itself start a new block" — this matches
 * CommonMark's behavior for common cases without tracking full block-parser
 * state inside the collector.
 */

import type { CstNode } from '../nodes';
import type { ParsedLine } from '../lines';
import { joinRaw, parseBlocks, isBlankLine } from '../parser';
import { startsNewBlock } from './paragraph';

export function matchBlockquote(text: string): boolean {
	return /^ {0,3}>/.test(text);
}

/** Strip the `> ` (or `>`) prefix from a blockquote line. */
function stripBlockquotePrefix(text: string): string {
	return text.replace(/^ {0,3}>[ \t]?/, '');
}

/**
 * A collected line keeps "the blockquote's current inner block is an open
 * paragraph" true iff the stripped content is non-blank and does not start
 * a new block. Blank lines close the open paragraph. Block openers (list
 * item, heading, fence, nested blockquote) close it as well — lazy
 * continuation only continues an *open paragraph*, not an open list or
 * container.
 */
function wouldKeepParagraphOpen(strippedText: string): boolean {
	if (isBlankLine(strippedText)) return false;
	if (startsNewBlock(strippedText)) return false;
	// A nested blockquote line (still starts with >) also closes lazy.
	if (matchBlockquote(strippedText)) return false;
	return true;
}

export function parseBlockquote(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string
): { node: CstNode; nextIndex: number } {
	// Collect lines. A line is collected if:
	//   - it matches `> ` (normal blockquote line), OR
	//   - it is a lazy continuation: no `>`, not blank, not a block opener,
	//     AND the previously-collected line had an open paragraph.
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
			// Lazy continuation — absorb this line unchanged into the blockquote.
			paragraphOpen = true;
			i++;
			continue;
		}
		break;
	}

	const raw = joinRaw(lines, startIndex, i);

	// Strip `> ` prefix from each line for recursive parse. Lazy
	// continuation lines have no prefix to strip — pass them through
	// verbatim so the recursive paragraph parser sees a continuous
	// multi-line paragraph.
	let offset = 0;
	const strippedLines = lines.slice(startIndex, i).map((line) => {
		const stripped = matchBlockquote(line.text) ? stripBlockquotePrefix(line.text) : line.text;
		const lineEnding = line.lineEnding;
		const raw = stripped + lineEnding;
		const strippedLine: ParsedLine = {
			raw,
			text: stripped,
			lineEnding,
			start: offset,
			end: offset + raw.length
		};
		offset += raw.length;
		return strippedLine;
	});

	const inner = parseBlocks(strippedLines, 0, strippedLines.length);

	// Count max quote depth
	const quoteDepth =
		lines[startIndex].text
			.match(/^ {0,3}(>[ \t]?)+/)?.[0]
			.split('')
			.filter((c) => c === '>').length ?? 1;

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
