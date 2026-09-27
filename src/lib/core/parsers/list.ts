/**
 * List parser with CommonMark §5.2 lazy continuation. "Open paragraph" is approximated per
 * line (non-blank, not a paragraph interrupter), as in the blockquote parser. Laziness reaches
 * only the item's own top-level paragraph, never one open inside a nested sub-list.
 */

import type { CstNode } from '../nodes';
import { indentColumns, remapStrippedLines, stripIndentColumns, type ParsedLine } from '../lines';
import { joinRaw, isBlankLine, parseBlocks } from '../parser';
import {
	lineInterruptsParagraph,
	lineStartsOuterBlock,
	type BlockOpenerResult,
	type GrammarView
} from '../../schema/block-openers';

// ── List markers ─────────────────────────────────────────────────────────────

// GFM §5.2: a marker, then spaces or tabs. A non-breaking space after the marker is content, so
// that line opens no item.
const BULLET = '[-*+]';
const withDelimiter = (digits: string): string => `${digits}[.)]`;
const MARKER = `(?:${BULLET}|${withDelimiter('\\d{1,9}')})`;
const GAP = '[ \\t]+';
const ITEM_START = new RegExp(`^( {0,3})(${MARKER}${GAP})`);
const CONTENTLESS_ITEM = new RegExp(`^ {0,3}${MARKER}${GAP}$`);
const INTERRUPTING_ITEM = new RegExp(`^ {0,3}(?:${BULLET}|${withDelimiter('1')})${GAP}[^ \\t]`);

export function matchListItem(
	text: string
): { marker: string; ordered: boolean; indent: number } | null {
	const m = text.match(ITEM_START);
	if (!m) return null;
	return {
		marker: m[2],
		ordered: /^\d/.test(m[2]),
		indent: m[0].length
	};
}

/** A marker line with nothing after the marker. The gap is required: a bare `-` opens no list. */
export function isContentlessItemLine(text: string): boolean {
	return CONTENTLESS_ITEM.test(text);
}

/**
 * The task marker at the start of `text`, the one reading of its extent: the box, then spaces or
 * tabs. Never a line ending, so a CRLF line's `\r` stays with the line's ending.
 */
export function matchTaskCheckbox(text: string): { checked: boolean; rawMarker: string } | null {
	const m = text.match(/^\[( |x|X)\][ \t]+/);
	return m ? { checked: m[1].toLowerCase() === 'x', rawMarker: m[0] } : null;
}

/**
 * CommonMark §5.2: a marker interrupts a paragraph only if bullet or starting at `1` and its
 * first item is non-empty, so neither "... is 2. bananas" nor a content-less marker is a list.
 * Standalone list parsing (`matchListItem`) accepts both.
 */
export function canInterruptParagraph(text: string): boolean {
	return INTERRUPTING_ITEM.test(text);
}

export function parseList(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string,
	grammar: GrammarView,
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

		// Any line indented to the content column belongs to the body, a whitespace-only one too; a
		// run of bare blank lines is taken in only when such a line follows it.
		while (i < endIndex) {
			if (indentColumns(lines[i].text) >= contentIndent) {
				paragraphOpen = wouldKeepParagraphOpen(stripIndentColumns(lines[i].text, contentIndent));
				i++;
			} else if (isBlankLine(lines[i].text)) {
				let j = i;
				while (
					j < endIndex &&
					isBlankLine(lines[j].text) &&
					indentColumns(lines[j].text) < contentIndent
				) {
					j++;
				}
				if (j < endIndex && indentColumns(lines[j].text) >= contentIndent) {
					i = j;
				} else {
					break;
				}
			} else if (
				paragraphOpen &&
				wouldKeepParagraphOpen(lines[i].text) &&
				!lineStartsOuterBlock(lines[i], { paragraphOpen: true, grammar })
			) {
				// Lazy continuation: the verbatim bytes stay in raw, and stripListItemLines
				// feeds the paragraph parser one continuous paragraph.
				i++;
			} else {
				break;
			}
		}

		const itemRaw = joinRaw(lines, itemStartIndex, i);
		const baseLines = stripListItemLines(lines, itemStartIndex, i, contentIndent);

		// A leading `[ ] ` is the task marker, and the rest of its line starts the item's paragraph
		// (GFM task lists). The lines are rebuilt so body offsets match the stripped bytes.
		const task = matchTaskCheckbox(baseLines.length > 0 ? baseLines[0].text : '');
		const strippedLines = task
			? remapStrippedLines(baseLines, (line, index) =>
					index === 0 ? line.text.slice(task.rawMarker.length) : line.text
				)
			: baseLines;

		const inner = parseBlocks(strippedLines, 0, strippedLines.length, {
			grammar,
			scope: isDocumentParse ? 'document' : 'fragment',
			depth: depth + 1,
			firstLineIsParagraph: task !== null
		});

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

/** The marker line loses its marker; every later line up to `contentIndent` columns. */
function stripListItemLines(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	contentIndent: number
): ParsedLine[] {
	return remapStrippedLines(lines.slice(startIndex, endIndex), (line, i) =>
		i === 0 ? line.text.slice(contentIndent) : stripIndentColumns(line.text, contentIndent)
	);
}
