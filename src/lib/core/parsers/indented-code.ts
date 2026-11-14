// The paragraph-interruption guard is dispatch context, not a line-level match, so it lives
// with the opener registration rather than the matcher.

import { indentColumns, type ParsedLine } from '../lines';
import { joinRaw, isBlankLine } from '../parser';
import type { BlockOpenerResult } from '../../schema/block-openers';

/** A code line: four columns of indent and something after them. A line of whitespace only is a
 *  blank line however wide (GFM §4.4), and stays in the block only between two code lines. */
export function matchIndentedCode(text: string): boolean {
	return indentColumns(text) >= 4 && !isBlankLine(text);
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
