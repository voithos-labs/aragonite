/**
 * Indented code block parser. Matches lines starting with 4 spaces or a tab.
 * Cannot interrupt a paragraph — the guard (`leadingTrivia.length > 0 || isFirstBlock`)
 * lives in parseNextBlock, not here.
 */

import type { CstNode } from '../nodes';
import type { ParsedLine } from '../lines';
import { joinRaw } from '../parser';

export function matchIndentedCode(text: string): boolean {
	return /^(?: {4}|\t)/.test(text);
}

export function parseIndentedCode(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string
): { node: CstNode; nextIndex: number } {
	let i = startIndex;

	while (i < endIndex) {
		if (matchIndentedCode(lines[i].text)) {
			i++;
		} else if (isBlankLine(lines[i].text)) {
			// Blank lines inside indented code are kept if followed by more indented lines
			let j = i + 1;
			while (j < endIndex && isBlankLine(lines[j].text)) j++;
			if (j < endIndex && matchIndentedCode(lines[j].text)) {
				i = j;
			} else {
				break;
			}
		} else {
			break;
		}
	}

	const raw = joinRaw(lines, startIndex, i);
	return {
		node: { kind: 'indentedCode', leadingTrivia, raw },
		nextIndex: i
	};
}

function isBlankLine(text: string): boolean {
	return text.trim().length === 0;
}
