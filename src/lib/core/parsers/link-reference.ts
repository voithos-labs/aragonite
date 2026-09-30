/**
 * Link reference definition parser, CommonMark §4.7 (`[label]: url "title"`). The label,
 * destination and title are read by the link grammar in `inline/link-destination.ts`, and may
 * continue on the lines after the first that a paragraph would absorb. Footnote labels
 * (`[^...]:`) stay paragraphs.
 */

import { isBlankLine, isWhitespaceChar, type ParsedLine } from '../lines';
import { joinRaw } from '../parser';
import {
	linkTitleValue,
	parseLinkDestination,
	scanLinkTitle,
	scanLinkLabel,
	SPAN_OPEN
} from '../inline/link-destination';
import { lineInterruptsParagraph, type BlockOpenerResult } from '../../schema/block-openers';
import { matchSetextUnderline } from './paragraph';

export function parseLinkReferenceDefinition(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string
): BlockOpenerResult | null {
	const labelStart = labelOpenerOffset(lines[startIndex].text);
	if (labelStart < 0) return null;
	const window = new DefinitionWindow(lines, startIndex, endIndex);
	const opener = readLabel(window, labelStart);
	if (!opener) return null;
	const { label, afterColon } = opener;
	if (label.startsWith('^')) return null;

	const destStart = skipSeparator(window, afterColon);
	const destination = parseLinkDestination(window.text, destStart, window.text.length);
	if (!destination) return null;

	// §4.7: non-whitespace after the destination that isn't a well-formed title on its own line
	// end means there is no definition; a title that fails on a later line leaves it untitled.
	let lastOffset = -1;
	let title: string | undefined;
	const titleStart = skipSeparator(window, destination.end);
	if (titleStart > destination.end) {
		const titleEnd = readSpan(window, titleStart, scanLinkTitle);
		if (titleEnd >= 0 && atLineEnd(window.text, titleEnd)) {
			lastOffset = titleEnd;
			title = linkTitleValue(window.text, titleStart, titleEnd);
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
		private readonly endIndex: number
	) {
		this.text = lines[startIndex].text;
		this.lineEnds = [this.text.length];
		this.next = startIndex + 1;
	}

	/** Joins the next line if a paragraph would continue onto it. */
	grow(): boolean {
		if (this.next >= this.endIndex) return false;
		const line = this.lines[this.next].text;
		if (isBlankLine(line) || lineInterruptsParagraph(line) || matchSetextUnderline(line)) {
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
function readSpan(window: DefinitionWindow, pos: number, scan: typeof scanLinkTitle): number {
	let from = pos + 1;
	for (;;) {
		const spanEnd = scan(window.text, pos, window.text.length, from);
		if (spanEnd !== SPAN_OPEN) return spanEnd;
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
	const labelEnd = readSpan(window, pos, scanLinkLabel);
	if (labelEnd < 0 || window.text[labelEnd] !== ':') return null;
	const label = window.text.slice(pos + 1, labelEnd - 1);
	// §6.6: a label holds at least one non-whitespace character, in §2.1's ASCII sense.
	if ([...label].every(isWhitespaceChar)) return null;
	return { label, afterColon: labelEnd + 1 };
}
