/**
 * List parser with CommonMark §5.2 lazy continuation. "Open paragraph" is approximated per
 * line (non-blank, not a paragraph interrupter), as in the blockquote parser. Laziness reaches
 * only the item's own top-level paragraph, never one open inside a nested sub-list.
 */

import type { CstNode } from '../nodes';
import { recordListMarkerReads } from '../../perf/instruments';
import type { NodeView } from '../node-views';
import { indentColumns, remapStrippedLines, stripIndentColumns, type ParsedLine } from '../lines';
import { joinRaw, isBlankLine, parseBlocks } from '../parser';
import {
	FIRST_LINE,
	INNER_LINE,
	hangingIndentLines,
	opensOuterBlock,
	type LineCodec
} from '../strip-lines';
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

/** A list item's line syntax: the marker on its first line, read back only with the same
 *  indent, marker and task box, and its other lines indented to the item's content column. */
export function listItemLines(shape: ItemLineShape): LineCodec {
	const opener = shape.indent + shape.marker + (shape.taskMarker ?? '');
	return hangingIndentLines({
		opener,
		column: shape.indent.length + shape.marker.length,
		readOpener(line) {
			const read = readItemShape(line);
			const same =
				read?.indent === shape.indent &&
				read.marker === shape.marker &&
				read.taskMarker === shape.taskMarker;
			return same ? opener : null;
		},
		// The parser asks the opening line with its task marker still on it.
		continuesLazily: (above, line, aboveFirst) =>
			wouldKeepParagraphOpen(aboveFirst ? (shape.taskMarker ?? '') + above : above) &&
			wouldKeepParagraphOpen(line) &&
			!opensOuterBlock(line)
	});
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
	const widths = markerWidthTally();
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
		widths.add(shape);
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
			markerWidths: widths.counts(),
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

// ── Marker widths ────────────────────────────────────────────────────────────

/**
 * How many of a list's items open with a list marker of each width (a to-do's `[ ] ` not counted):
 * plain items at `2 * width`, to-dos at `2 * width + 1`, no trailing zeros. What its marker column
 * is sized from; the parse stores it on the list node and the list's rebuild keeps it, so no key
 * rereads the items. Never written in place: an undo entry may hold the array.
 */
export type MarkerWidths = Uint32Array;

/** The counts over `items`, one read of each item's first line. */
export function markerWidthCounts(items: readonly Pick<NodeView, 'raw'>[]): MarkerWidths {
	const tally = markerWidthTally();
	// Indexed: the items may be a `$state` proxy, where an iterator pays a trap per step.
	for (let i = 0; i < items.length; i++) tally.add(readItemShape(items[i].raw));
	return tally.counts();
}

/** The same counts taken one item at a time, for a pass that already reads every item's shape.
 *  An item's whole `raw` reads as its first line: the match is anchored and stops at its end. */
export function markerWidthTally(): {
	add(shape: ItemLineShape | null): void;
	counts(): MarkerWidths;
} {
	const counts: number[] = [];
	return {
		add(shape) {
			const slot = slotOf(shape);
			if (slot !== null) bump(counts, slot, 1);
		},
		counts: () => packed(counts)
	};
}

/** `counts` once one item's bytes went from `previousRaw` to `raw`: a fresh array when a width
 *  moved, `counts` itself when none did. */
export function countsAfterRewrite(
	counts: MarkerWidths,
	previousRaw: string,
	raw: string
): MarkerWidths {
	const before = slotOf(readItemShape(previousRaw));
	const after = slotOf(readItemShape(raw));
	if (before === after) return counts;
	const next = Array.from(counts);
	if (before !== null) bump(next, before, -1);
	if (after !== null) bump(next, after, 1);
	return packed(next);
}

export function sameMarkerWidths(a: MarkerWidths, b: MarkerWidths): boolean {
	return a.length === b.length && a.every((n, i) => n === b[i]);
}

/** A list's counts, recounted from its items when no parse or rebuild stored them (a node built
 *  past the types); the list's next rebuild stores them. */
export function markerWidthsOf(list: NodeView): MarkerWidths {
	if (list.markerWidths) return list.markerWidths;
	const items = list.children ?? [];
	recordListMarkerReads(items.length);
	return markerWidthCounts(items);
}

/** The widest list marker of a plain item and of a to-do, in characters, and whether any to-do. */
export function widestMarkers(counts: MarkerWidths): {
	plain: number;
	task: number;
	anyTask: boolean;
} {
	let plain = 0;
	let task = 0;
	for (let slot = 0; slot < counts.length; slot++) {
		if (counts[slot] === 0) continue;
		if (slot % 2 === 0) plain = slot / 2;
		else task = (slot - 1) / 2;
	}
	return { plain, task, anyTask: task > 0 };
}

function slotOf(shape: ItemLineShape | null): number | null {
	if (!shape) return null;
	return 2 * shape.marker.length + (shape.taskMarker !== null ? 1 : 0);
}

function bump(counts: number[], slot: number, by: number): void {
	while (counts.length <= slot) counts.push(0);
	counts[slot] += by;
}

/** No trailing zeros, so the counts a rebuild keeps equal the ones a parse of the same bytes gives. */
function packed(counts: number[]): MarkerWidths {
	let end = counts.length;
	while (end > 0 && counts[end - 1] === 0) end--;
	return Uint32Array.from(counts.slice(0, end));
}
