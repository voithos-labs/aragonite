/**
 * List parser with CommonMark §5.2 lazy continuation. "Open paragraph" is approximated per
 * line (non-blank, not a paragraph interrupter), as in the blockquote parser. Laziness reaches
 * only the item's own top-level paragraph, never one open inside a nested sub-list.
 */

import type { CstNode } from '../nodes';
import { remapStrippedLines, type ParsedLine } from '../lines';
import { joinRaw, isBlankLine, parseBlocks } from '../parser';
import {
	defaultGrammarView,
	lineInterruptsParagraph,
	type BlockOpenerResult
} from '../../schema/block-openers';

export function matchListItem(
	text: string
): { marker: string; ordered: boolean; indent: number } | null {
	const m = text.match(/^( {0,3})([-*+]\s+)/);
	if (m) {
		return {
			marker: m[2],
			ordered: false,
			indent: m[0].length
		};
	}

	const om = text.match(/^( {0,3})(\d{1,9}[.)]\s+)/);
	if (om) {
		return {
			marker: om[2],
			ordered: true,
			indent: om[0].length
		};
	}

	return null;
}

function matchTaskCheckbox(text: string): { checked: boolean; rawMarker: string } | null {
	const m = text.match(/^\[( |x|X)\]\s+/);
	return m ? { checked: m[1].toLowerCase() === 'x', rawMarker: m[0] } : null;
}

/**
 * CommonMark §5.2: a marker interrupts a paragraph only if bullet or starting at `1`, so
 * "... is 2. bananas" is not a list. Standalone list parsing accepts any ordered number.
 */
export function canInterruptParagraph(text: string): boolean {
	if (/^ {0,3}[-*+]\s+/.test(text)) return true;
	return /^ {0,3}1[.)]\s+/.test(text);
}

export function parseList(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string,
	depth: number = 0,
	isDocumentParse: boolean = false
): BlockOpenerResult {
	const firstMatch = matchListItem(lines[startIndex].text)!;
	const ordered = firstMatch.ordered;
	const items: CstNode[] = [];
	let i = startIndex;

	while (i < endIndex) {
		const itemMatch = matchListItem(lines[i].text);
		if (!itemMatch || itemMatch.ordered !== ordered) break;

		const contentIndent = itemMatch.indent;
		const itemStartIndex = i;
		// The marker line strips to its content; a paragraph is open unless that content opens a block.
		let paragraphOpen = wouldKeepParagraphOpen(lines[i].text.slice(contentIndent));
		i++;

		// Blank lines are absorbed if followed by indented content, making multi-paragraph items.
		while (i < endIndex) {
			if (isBlankLine(lines[i].text)) {
				let j = i;
				while (j < endIndex && isBlankLine(lines[j].text)) j++;
				if (j < endIndex && getIndent(lines[j].text) >= contentIndent) {
					paragraphOpen = wouldKeepParagraphOpen(lines[j].text.slice(contentIndent));
					i = j + 1;
				} else {
					break;
				}
			} else if (getIndent(lines[i].text) >= contentIndent) {
				paragraphOpen = wouldKeepParagraphOpen(lines[i].text.slice(contentIndent));
				i++;
			} else if (paragraphOpen && wouldKeepParagraphOpen(lines[i].text)) {
				// Lazy continuation: the verbatim bytes stay in raw, and stripListItemLines
				// feeds the paragraph parser one continuous paragraph.
				i++;
			} else {
				break;
			}
		}

		const itemRaw = joinRaw(lines, itemStartIndex, i);
		const baseLines = stripListItemLines(lines, itemStartIndex, i, contentIndent);

		// A leading `[ ] ` is the task marker; re-mint so body offsets match its shortened bytes.
		const task = matchTaskCheckbox(baseLines.length > 0 ? baseLines[0].text : '');
		const strippedLines = task
			? remapStrippedLines(baseLines, (line, index) =>
					index === 0 ? line.text.slice(task.rawMarker.length) : line.text
				)
			: baseLines;

		const inner = parseBlocks(
			strippedLines,
			0,
			strippedLines.length,
			defaultGrammarView,
			depth + 1,
			isDocumentParse
		);

		items.push({
			kind: 'listItem',
			leadingTrivia: '',
			raw: itemRaw,
			metadata: {
				marker: itemMatch.marker,
				taskItem: task !== null,
				taskChecked: task?.checked ?? false,
				taskMarker: task?.rawMarker ?? null
			},
			innerPrefix: '',
			children: inner.children,
			innerSuffix: inner.suffix
		});
	}

	const raw = joinRaw(lines, startIndex, i);

	return {
		node: {
			kind: 'list',
			leadingTrivia,
			raw,
			metadata: { ordered },
			innerPrefix: '',
			children: items,
			innerSuffix: ''
		},
		consumed: i - startIndex
	};
}

function getIndent(text: string): number {
	const m = text.match(/^( *)/);
	return m ? m[1].length : 0;
}

/**
 * Lazy continuation extends only an open paragraph. Any list marker is block-level, resolved
 * by the outer item loop, so an ordered marker not starting at 1 is excluded here even though
 * §5.2 says it cannot interrupt a paragraph.
 */
function wouldKeepParagraphOpen(strippedText: string): boolean {
	if (isBlankLine(strippedText)) return false;
	if (matchListItem(strippedText)) return false;
	if (lineInterruptsParagraph(strippedText)) return false;
	return true;
}

function stripListItemLines(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	contentIndent: number
): ParsedLine[] {
	return remapStrippedLines(lines.slice(startIndex, endIndex), (line, i) => {
		const stripCount = i === 0 ? contentIndent : Math.min(getIndent(line.text), contentIndent);
		return line.text.slice(stripCount);
	});
}
