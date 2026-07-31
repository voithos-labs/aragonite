// The paragraph-interruption guard is dispatch context, not a line-level match, so it lives
// with the opener registration rather than the matcher.

import type { ParsedLine } from '../lines';
import { joinRaw, isBlankLine } from '../parser';
import type { BlockOpenerResult } from '../../schema/block-openers';

export function matchIndentedCode(text: string): boolean {
	return /^(?: {4}|\t)/.test(text);
}

export function parseIndentedCode(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string
): BlockOpenerResult {
	let i = startIndex;

	while (i < endIndex) {
		if (matchIndentedCode(lines[i].text)) {
			i++;
		} else if (isBlankLine(lines[i].text)) {
			// Blank lines stay inside the block only if followed by more indented content.
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
		consumed: i - startIndex
	};
}
