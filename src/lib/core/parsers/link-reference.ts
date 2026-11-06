/**
 * Link reference definition parser, CommonMark §4.7 (`[label]: url "title"`). The label,
 * destination and title are read by the link grammar in `inline/scan/link-grammar.ts`, and may
 * continue on the lines after the first that a paragraph would absorb. Footnote labels
 * (`[^...]:`) stay paragraphs.
 */

import { isBlankLine, isWhitespaceChar, splitLines, type ParsedLine } from '../lines';
import { joinRaw } from '../parser';
import {
	labelEnd,
	readDestination,
	readTitle,
	STILL_OPEN,
	titleValue
} from '../inline/scan/link-grammar';
import type { BlockOpenerResult, GrammarView } from '../../schema/block-openers';
import { defaultGrammarView } from '../../schema/editor-grammar';
import { matchSetextUnderline } from './paragraph';

export function parseLinkReferenceDefinition(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string,
	grammar: GrammarView
): BlockOpenerResult | null {
	const labelStart = labelOpenerOffset(lines[startIndex].text);
	if (labelStart < 0) return null;
	const window = new DefinitionWindow(lines, startIndex, endIndex, grammar);
	const opener = readLabel(window, labelStart);
	if (!opener) return null;
	const { label, afterColon } = opener;
	if (label.startsWith('^')) return null;

	const destStart = skipSeparator(window, afterColon);
	const destination = readDestination(window.text, destStart, window.text.length);
	if (!destination) return null;

	// §4.7: non-whitespace after the destination that isn't a well-formed title on its own line
	// end means there is no definition; a title that fails on a later line leaves it untitled.
	let lastOffset = -1;
	let title: string | undefined;
	const titleStart = skipSeparator(window, destination.end);
	if (titleStart > destination.end) {
		const titleEnd = readSpan(window, titleStart, readTitle);
		if (titleEnd >= 0 && atLineEnd(window.text, titleEnd)) {
			lastOffset = titleEnd;
			title = titleValue(window.text, titleStart, titleEnd);
		}
	}
	if (lastOffset < 0) {
		if (!atLineEnd(window.text, destination.end)) return null;
		lastOffset = destination.end;
	}

	const endLine = window.lineAt(lastOffset) + 1;
	return {
		node: {
			kind: 'linkReferenceDefinition',
			leadingTrivia,
			raw: joinRaw(lines, startIndex, endLine),
			metadata: {
				label,
				url: destination.url,
				...(title !== undefined ? { title } : {})
			}
		},
		consumed: endLine - startIndex
	};
}

// ── The lines a definition can span ─────────────────────────────────────────

/** The definition's first line plus each later line a paragraph would continue onto, joined by
 *  `\n` without leading whitespace (§4.7); a line joins only when a read runs off the end. */
class DefinitionWindow {
	text: string;
	/** Offset in `text` where each joined line ends. */
	private readonly lineEnds: number[];
	private next: number;

	constructor(
		private readonly lines: ParsedLine[],
		private readonly startIndex: number,
		private readonly endIndex: number,
		private readonly grammar: GrammarView
	) {
		this.text = lines[startIndex].text;
		this.lineEnds = [this.text.length];
		this.next = startIndex + 1;
	}

	/** Joins the next line if a paragraph would continue onto it. */
	grow(): boolean {
		if (this.next >= this.endIndex) return false;
		const line = this.lines[this.next].text;
		if (isBlankLine(line) || this.grammar.interruptsParagraph(line) || matchSetextUnderline(line)) {
			return false;
		}
		this.text += '\n' + line.replace(/^[ \t]+/, '');
		this.lineEnds.push(this.text.length);
		this.next++;
		return true;
	}

	/** The index into `lines` of the joined line holding `offset`. */
	lineAt(offset: number): number {
		let i = 0;
		while (this.lineEnds[i] < offset) i++;
		return this.startIndex + i;
	}
}

/** Skips spaces and tabs with at most one line ending among them, joining that next line. */
function skipSeparator(window: DefinitionWindow, pos: number): number {
	pos = skipSpaces(window.text, pos);
	if (pos === window.text.length && !window.grow()) return pos;
	return window.text[pos] === '\n' ? skipSpaces(window.text, pos + 1) : pos;
}

/** The end of the label or title opening at `pos`, joining lines until it closes, or a miss. */
function readSpan(window: DefinitionWindow, pos: number, scan: typeof readTitle): number {
	let from = pos + 1;
	for (;;) {
		const spanEnd = scan(window.text, pos, window.text.length, from);
		if (spanEnd !== STILL_OPEN) return spanEnd;
		from = window.text.length;
		if (!window.grow()) return -1;
	}
}

// The document's last line can end in a lone `\r`, which the line splitter leaves in its text.
function atLineEnd(text: string, pos: number): boolean {
	pos = skipSpaces(text, pos);
	if (text[pos] === '\r') pos++;
	return pos === text.length || text[pos] === '\n';
}

function skipSpaces(text: string, pos: number): number {
	while (text[pos] === ' ' || text[pos] === '\t') pos++;
	return pos;
}

// ── Label ───────────────────────────────────────────────────────────────────

/** Whether lines below a block with these bytes could still change it: a label not closed yet, a
 *  `]:` awaiting its destination, or a definition with no title, which takes one from below. */
export function definitionReadingNotFinal(raw: string): boolean {
	// The first line decides before any line is split, since a walk asks this of every block.
	if (labelOpenerOffset(raw) < 0) return false;
	const lines = splitLines(raw);
	const labelStart = labelOpenerOffset(lines[0].text);
	// A reading takes no grammar, so its lines below read as a parse with no editor would.
	const window = new DefinitionWindow(lines, 0, lines.length, defaultGrammarView);
	const labelClose = readSpan(window, labelStart, labelEnd);
	// A label that never closed may still close below; one followed by anything but `:` is a link.
	if (labelClose >= 0 && window.text[labelClose] !== ':') return false;
	const definition = parseLinkReferenceDefinition(lines, 0, lines.length, '', defaultGrammarView);
	return definition === null || !('title' in (definition.node.metadata ?? {}));
}

/** Where the definition's `[` sits, up to three spaces in, or -1. */
function labelOpenerOffset(line: string): number {
	let pos = 0;
	while (pos < 3 && line[pos] === ' ') pos++;
	return line[pos] === '[' ? pos : -1;
}

/** The label opening at `pos` and the offset past its `]:`. */
function readLabel(
	window: DefinitionWindow,
	pos: number
): { label: string; afterColon: number } | null {
	const labelClose = readSpan(window, pos, labelEnd);
	if (labelClose < 0 || window.text[labelClose] !== ':') return null;
	const label = window.text.slice(pos + 1, labelClose - 1);
	// §6.6: a label holds at least one non-whitespace character, in §2.1's ASCII sense.
	if ([...label].every(isWhitespaceChar)) return null;
	return { label, afterColon: labelClose + 1 };
}
