/**
 * Blockquote parser. Collects continuation lines with `> ` prefixes, strips
 * them, and recursively parses the stripped content.
 */

import type { CstNode } from '../nodes';
import type { ParsedLine } from '../lines';
import { joinRaw, parseBlocks } from '../parser';

export function matchBlockquote(text: string): boolean {
	return /^ {0,3}>/.test(text);
}

export function parseBlockquote(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string
): { node: CstNode; nextIndex: number } {
	// Collect continuation lines
	let i = startIndex;
	while (i < endIndex && matchBlockquote(lines[i].text)) {
		i++;
	}

	const raw = joinRaw(lines, startIndex, i);

	// Strip `> ` prefix from each line for recursive parse
	let offset = 0;
	const strippedLines = lines.slice(startIndex, i).map((line) => {
		const stripped = line.text.replace(/^ {0,3}>[ \t]?/, '');
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
