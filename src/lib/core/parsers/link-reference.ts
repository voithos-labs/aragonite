/**
 * Link reference definition parser, CommonMark §4.7 (`[label]: url "title"`). The destination and
 * title are read by the inline link grammar in `inline/link-destination.ts`, and may continue on
 * the lines after the label that a paragraph would absorb. Footnote labels (`[^...]:`) stay
 * paragraphs.
 */

import { isBlankLine, isWhitespaceChar, type ParsedLine } from '../lines';
import { ESCAPABLE_PUNCTUATION } from '../escapable';
import { joinRaw } from '../parser';
import {
	linkTitleValue,
	parseLinkDestination,
	scanLinkTitle,
	TITLE_OPEN
} from '../inline/link-destination';
import { lineInterruptsParagraph, type BlockOpenerResult } from '../../schema/block-openers';
import { matchSetextUnderline } from './paragraph';

export function parseLinkReferenceDefinition(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string
): BlockOpenerResult | null {
	const opener = matchLabelOpener(lines[startIndex].text);
	if (!opener) return null;
	const { label, afterColon } = opener;
	if (label.startsWith('^')) return null;

	const window = new DefinitionWindow(lines, startIndex, endIndex);
	const destStart = skipSeparator(window, afterColon);
	const destination = parseLinkDestination(window.text, destStart, window.text.length);
	if (!destination) return null;

	// §4.7: non-whitespace after the destination that isn't a well-formed title on its own line
	// end means there is no definition; a title that fails on a later line leaves it untitled.
	let lastOffset = -1;
	let title: string | undefined;
	const titleStart = skipSeparator(window, destination.end);
	if (titleStart > destination.end) {
		const titleEnd = readTitle(window, titleStart);
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

/**
 * The label line plus each later line a paragraph would continue onto, joined by `\n` and
 * without their leading whitespace, the way §4.7 reads a paragraph's content. Lines join only
 * when a read runs off the end, so a run of one-line definitions never joins at all.
 */
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

/** The end of the title opening at `pos`, joining lines until it closes, or a negative miss. */
function readTitle(window: DefinitionWindow, pos: number): number {
	let from = pos + 1;
	for (;;) {
		const titleEnd = scanLinkTitle(window.text, pos, window.text.length, from);
		if (titleEnd !== TITLE_OPEN) return titleEnd;
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

// CommonMark §4.7: brackets inside a label may be backslash-escaped. A label that spans lines,
// and the refusal of an unescaped `[`, are not read.
function matchLabelOpener(line: string): { label: string; afterColon: number } | null {
	let i = 0;
	while (i < line.length && i < 3 && line[i] === ' ') i++;
	if (line[i] !== '[') return null;
	const labelStart = i + 1;
	let j = labelStart;
	while (j < line.length) {
		const ch = line[j];
		if (ch === '\\' && j + 1 < line.length && ESCAPABLE_PUNCTUATION.has(line[j + 1])) {
			j += 2;
			continue;
		}
		if (ch === ']') break;
		j++;
	}
	if (j >= line.length || line[j] !== ']') return null;
	if (j + 1 >= line.length || line[j + 1] !== ':') return null;
	const label = line.slice(labelStart, j);
	// §6.6: a label holds at least one non-whitespace character, in §2.1's ASCII sense.
	if ([...label].every(isWhitespaceChar)) return null;
	return { label, afterColon: j + 2 };
}
