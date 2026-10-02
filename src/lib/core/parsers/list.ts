/**
 * List parser with CommonMark §5.2 lazy continuation. "Open paragraph" is approximated per
 * line (non-blank, not a paragraph interrupter), as in the blockquote parser. Laziness reaches
 * only the item's own top-level paragraph, never one open inside a nested sub-list.
 */

import type { CstNode } from '../nodes';
import { indentColumns, remapStrippedLines, stripIndentColumns, type ParsedLine } from '../lines';
import { joinRaw, isBlankLine, parseBlocks } from '../parser';
import { FIRST_LINE, INNER_LINE, opensOuterBlock, type LineCodec } from '../strip-lines';
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
// Content after the gap: neither a space or tab nor a line ending the splitter left on the line.
const INTERRUPTING_ITEM = new RegExp(
	`^ {0,3}(?:${BULLET}|${withDelimiter('1')})${GAP}[^ \\t\\r\\n]`
);

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

/** What a list item's lines are written under, all of it read off the item's first line. */
export interface ItemLineShape {
	/** The up to three spaces before the marker. */
	indent: string;
	marker: string;
	taskMarker: string | null;
}

/** `line` read as a list item's first line, or null when it opens no item. */
export function readItemShape(line: string): ItemLineShape | null {
	const m = line.match(ITEM_START);
	if (!m) return null;
	const task = matchTaskCheckbox(line.slice(m[0].length));
	return { indent: m[1], marker: m[2], taskMarker: task?.rawMarker ?? null };
}

/**
 * A list item's line syntax: the marker on its first line, and its other lines indented to the
 * item's content column, a blank separator bare and a blank line ending the body indented.
 */
export function listItemLines(shape: ItemLineShape): LineCodec {
	const column = shape.indent.length + shape.marker.length;
	const opener = shape.indent + shape.marker + (shape.taskMarker ?? '');
	const pad = ' '.repeat(column);
	return {
		read(line, place) {
			if (place.first) {
				const read = readItemShape(line);
				const same =
					read?.indent === shape.indent &&
					read.marker === shape.marker &&
					read.taskMarker === shape.taskMarker;
				return same ? { text: line.slice(opener.length), prefix: opener, lazy: false } : null;
			}
			const text = stripIndentColumns(line, column);
			if (indentColumns(line) >= column) {
				const cut = line.length - text.length;
				// Compared as a slice: V8's `endsWith` steps through the text a character at a time.
				const prefix = cut >= 0 && line.slice(cut) === text ? line.slice(0, cut) : null;
				return { text, prefix, lazy: false };
			}
			// Below the content column a blank line still separates, but can't end the body.
			if (isBlankLine(line))
				return place.trailingBlank ? null : { text, prefix: line, lazy: false };
			return { text, prefix: line.slice(0, line.length - text.length), lazy: true };
		},
		write(text, place) {
			if (place.first) return opener + text;
			return text === '' && !place.trailingBlank ? '' : pad + text;
		},
		spells(line, text, place) {
			// The opening line is read for its marker, which the text after it can change.
			if (place.first) return false;
			if (text === '' && !place.trailingBlank) return line === '';
			return (
				line.length === column + text.length &&
				line.startsWith(pad) &&
				line.slice(column) === text &&
				!(column % 4 !== 0 && leadingTab(text))
			);
		},
		// The parser asks the opening line with its task marker still on it.
		continuesLazily: (above, line, aboveFirst) =>
			wouldKeepParagraphOpen(aboveFirst ? (shape.taskMarker ?? '') + above : above) &&
			wouldKeepParagraphOpen(line) &&
			!opensOuterBlock(line)
	};
}

/** Whether a tab sits in `text`'s leading whitespace, which a read at a column off the tab stops
 *  rewrites as spaces. */
function leadingTab(text: string): boolean {
	for (let i = 0; text[i] === ' ' || text[i] === '\t'; i++) if (text[i] === '\t') return true;
	return false;
}

/** CommonMark §5.2: a marker interrupts a paragraph only as a bullet or at `1`, with a non-empty
 *  first item, so "... is 2. bananas" is no list. `matchListItem` accepts both. */
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
				// Lazy continuation: the verbatim bytes stay in raw, and the item's line reading
				// feeds the paragraph parser one continuous paragraph.
				i++;
			} else {
				break;
			}
		}

		const itemRaw = joinRaw(lines, itemStartIndex, i);
		// A leading `[ ] ` is the task marker, and the rest of its line starts the item's paragraph
		// (GFM task lists).
		const shape = readItemShape(lines[itemStartIndex].text)!;
		const itemLines = listItemLines(shape);
		const strippedLines = remapStrippedLines(
			lines.slice(itemStartIndex, i),
			(line, index) => itemLines.read(line.text, index === 0 ? FIRST_LINE : INNER_LINE)!.text
		);
		const task = shape.taskMarker;

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
				taskChecked: task !== null && /^\[[xX]\]/.test(task),
				taskMarker: task
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

/** Lazy continuation extends only an open paragraph. Every list marker is left to the item loop, so
 *  an ordered marker not at 1 is excluded here too. */
function wouldKeepParagraphOpen(strippedText: string): boolean {
	if (isBlankLine(strippedText)) return false;
	if (matchListItem(strippedText)) return false;
	if (lineInterruptsParagraph(strippedText)) return false;
	return true;
}
