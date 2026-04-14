/**
 * HTML block parser (simplified — continues until a blank line).
 */

import type { CstNode } from '../nodes';
import type { ParsedLine } from '../lines';
import { joinRaw } from '../parser';

const HTML_BLOCK_OPEN =
	/^ {0,3}(?:<(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|pre|script|section|source|style|summary|table|tbody|td|template|tfoot|th|thead|title|tr|track|ul)[\s/>]|<!--|<\?|<![A-Z]|<!\[CDATA\[)/i;

export function matchHtmlBlock(text: string): boolean {
	return HTML_BLOCK_OPEN.test(text);
}

export function parseHtmlBlock(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string
): { node: CstNode; nextIndex: number } {
	let i = startIndex + 1;

	// Simplified: HTML blocks continue until a blank line
	while (i < endIndex && !isBlankLine(lines[i].text)) {
		i++;
	}

	const raw = joinRaw(lines, startIndex, i);
	return {
		node: { kind: 'htmlBlock', leadingTrivia, raw },
		nextIndex: i
	};
}

function isBlankLine(text: string): boolean {
	return text.trim().length === 0;
}
