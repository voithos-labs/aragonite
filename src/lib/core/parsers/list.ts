import type { CstNode } from '../nodes';
import type { ParsedLine } from '../lines';
import { joinRaw, isBlankLine, parseBlocks } from '../parser';
import { defaultGrammarView } from '../../schema/block-openers';

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
 * CommonMark §5.2: a list marker interrupts a paragraph only if it's a
 * bullet or starts at `1` — avoids misreading "... is 2. bananas" as a
 * list. Standalone list parsing still accepts any ordered number.
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
	depth: number = 0
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

		// Blank lines are absorbed if followed by indented content — multi-paragraph items.
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

		const itemRaw = joinRaw(lines, itemStartIndex, i);
		const strippedLines = stripListItemLines(lines, itemStartIndex, i, contentIndent);

		const firstStrippedText = strippedLines.length > 0 ? strippedLines[0].text : '';
		const task = matchTaskCheckbox(firstStrippedText);

		if (task && strippedLines.length > 0) {
			const first = strippedLines[0];
			const newText = firstStrippedText.slice(task.rawMarker.length);
			strippedLines[0] = {
				...first,
				text: newText,
				raw: newText + first.lineEnding
			};
		}

		const inner = parseBlocks(
			strippedLines,
			0,
			strippedLines.length,
			defaultGrammarView,
			depth + 1
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
		// First line strips the marker prefix; continuation lines strip up to contentIndent.
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
