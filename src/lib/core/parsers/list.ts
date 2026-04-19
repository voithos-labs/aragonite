/**
 * List parser. Handles ordered and unordered lists, task checkboxes, and
 * multi-paragraph items with continuation indentation. Recursively parses
 * inner item content via parseBlocks.
 */

import type { CstNode } from '../nodes';
import type { ParsedLine } from '../lines';
import { joinRaw, isBlankLine, parseBlocks } from '../parser';

/**
 * Match an ordered or unordered list item on `text`. Returns marker + indent
 * metadata, or null. Currently exported from parser.ts for external callers;
 * Task 10 re-exports it from parser.ts.
 */
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

function matchTaskCheckbox(text: string): { checked: boolean } | null {
	const m = text.match(/^\[( |x|X)\]\s+/);
	return m ? { checked: m[1].toLowerCase() === 'x' } : null;
}

/**
 * Per CommonMark §5.2, a list marker can interrupt an open paragraph only
 * if the marker is a bullet or an ordered marker starting with `1` — this
 * prevents hard-wrapped numerals like "the fifth item is 2. bananas" from
 * being mistaken for a list start. Used by paragraph-continuation scans;
 * standalone list parsing (outside paragraph continuation) still accepts
 * any ordered number.
 */
export function canInterruptParagraph(text: string): boolean {
	if (/^ {0,3}[-*+]\s+/.test(text)) return true;
	return /^ {0,3}1[.)]\s+/.test(text);
}

export function parseList(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string
): { node: CstNode; nextIndex: number } {
	const firstMatch = matchListItem(lines[startIndex].text)!;
	const ordered = firstMatch.ordered;
	const items: CstNode[] = [];
	let i = startIndex;

	while (i < endIndex) {
		const itemMatch = matchListItem(lines[i].text);
		if (!itemMatch || itemMatch.ordered !== ordered) break;

		const contentIndent = itemMatch.indent;
		const itemStartIndex = i;
		i++;

		// Collect continuation lines: indented by at least contentIndent spaces.
		// Blank lines are included if followed by indented content (multi-paragraph items).
		while (i < endIndex) {
			if (isBlankLine(lines[i].text)) {
				let j = i;
				while (j < endIndex && isBlankLine(lines[j].text)) j++;
				if (j < endIndex && getIndent(lines[j].text) >= contentIndent) {
					i = j + 1;
				} else {
					break;
				}
			} else if (getIndent(lines[i].text) >= contentIndent) {
				i++;
			} else {
				break;
			}
		}

		// Lines [itemStartIndex, i) belong to this item
		const itemRaw = joinRaw(lines, itemStartIndex, i);
		const strippedLines = stripListItemLines(lines, itemStartIndex, i, contentIndent);

		// Detect task checkbox from first stripped line
		const firstStrippedText = strippedLines.length > 0 ? strippedLines[0].text : '';
		const task = matchTaskCheckbox(firstStrippedText);

		// Parse inner content recursively
		const inner = parseBlocks(strippedLines, 0, strippedLines.length);

		items.push({
			kind: 'listItem',
			leadingTrivia: '',
			raw: itemRaw,
			metadata: {
				marker: itemMatch.marker,
				taskItem: task !== null,
				taskChecked: task?.checked ?? false
			},
			innerPrefix: inner.prefix,
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
		nextIndex: i
	};
}

function getIndent(text: string): number {
	const m = text.match(/^( *)/);
	return m ? m[1].length : 0;
}

function stripListItemLines(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	contentIndent: number
): ParsedLine[] {
	let offset = 0;
	return lines.slice(startIndex, endIndex).map((line, i) => {
		// First line: strip the full marker prefix
		// Other lines: strip up to contentIndent spaces of indentation
		const stripCount = i === 0 ? contentIndent : Math.min(getIndent(line.text), contentIndent);
		const stripped = line.text.slice(stripCount);
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
}
