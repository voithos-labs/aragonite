/**
 * Link reference definition parser, CommonMark §4.7 (`[label]: url "title"`, URL and title
 * allowed on continuation lines). Footnote labels (`[^...]:`) are excluded; they stay paragraphs.
 */

import type { ParsedLine } from '../lines';
import { ESCAPABLE_PUNCTUATION } from '../escapable';
import { joinRaw } from '../parser';
import { lineInterruptsParagraph, type BlockOpenerResult } from '../../schema/block-openers';
import { matchSetextUnderline } from './paragraph';

export function parseLinkReferenceDefinition(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string
): BlockOpenerResult | null {
	const first = lines[startIndex];
	const opener = matchLabelOpener(first.text);
	if (!opener) return null;
	const { label, afterColon } = opener;
	if (label.startsWith('^')) return null;

	// Resolve which line the destination sits on first, then run one url + title tail over it.
	const destination = resolveDestinationSegment(afterColon, lines, startIndex, endIndex);
	if (!destination) return null;

	const urlResult = parseUrl(destination.segment);
	if (!urlResult) return null;
	const url = urlResult.url;

	let lineCursor = destination.segmentLine;
	const afterUrl = stripLeadingSpaces(destination.segment.slice(urlResult.consumed));
	const tail = resolveTitle(afterUrl, lines, lineCursor + 1, endIndex);
	if (!tail) return null;
	const title = tail.title;
	if (tail.titleLine !== null) lineCursor = tail.titleLine;

	const raw = joinRaw(lines, startIndex, lineCursor + 1);
	return {
		node: {
			kind: 'linkReferenceDefinition',
			leadingTrivia,
			raw,
			metadata: {
				label,
				url,
				...(title !== undefined ? { title } : {})
			}
		},
		consumed: lineCursor + 1 - startIndex
	};
}

function stripLeadingSpaces(s: string): string {
	return s.replace(/^[ \t]*/, '');
}

/**
 * CommonMark §4.7 allows one line ending before the destination, so an empty same-line tail
 * defers to the next line. A next line that opens a block or underlines the label line as a
 * setext heading, and an empty one, decline.
 */
function resolveDestinationSegment(
	afterColon: string,
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number
): { segment: string; segmentLine: number } | null {
	const sameLine = stripLeadingSpaces(afterColon);
	if (sameLine.length > 0) return { segment: sameLine, segmentLine: startIndex };

	const nextLineIndex = startIndex + 1;
	if (nextLineIndex >= endIndex) return null;
	const nextLine = lines[nextLineIndex];
	if (lineInterruptsParagraph(nextLine.text)) return null;
	if (matchSetextUnderline(nextLine.text)) return null;
	const segment = stripLeadingSpaces(nextLine.text);
	if (segment.length === 0) return null;
	return { segment, segmentLine: nextLineIndex };
}

// CommonMark §4.7: brackets inside a label may be backslash-escaped. Multi-line labels and
// unescaped-`[` rejection are out of scope for this line-oriented parser.
function matchLabelOpener(line: string): { label: string; afterColon: string } | null {
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
	// §4.7: a label holds at least one non-whitespace character.
	if (label.trim() === '') return null;
	return { label, afterColon: line.slice(j + 2) };
}

function parseUrl(s: string): { url: string; consumed: number } | null {
	if (s.length === 0) return null;
	if (s[0] === '<') {
		const close = s.indexOf('>', 1);
		if (close === -1) return null;
		return { url: s.slice(1, close), consumed: close + 1 };
	}
	const m = s.match(/^(\S+)/);
	if (!m) return null;
	return { url: m[1], consumed: m[1].length };
}

const TITLE_CLOSER: Record<string, string> = { '"': '"', "'": "'", '(': ')' };

function matchTitleSingleLine(s: string): { title: string; consumed: number } | null {
	const closer = TITLE_CLOSER[s[0]];
	if (!closer) return null;
	const close = s.indexOf(closer, 1);
	if (close === -1) return null;
	return { title: s.slice(1, close), consumed: close + 1 };
}

/** A title iff `s` holds one well-formed title and nothing but spaces after it. */
function wholeLineTitle(s: string): { title: string } | null {
	const t = matchTitleSingleLine(s);
	if (!t) return null;
	return stripLeadingSpaces(s.slice(t.consumed)).length === 0 ? { title: t.title } : null;
}

/**
 * `null` invalidates the whole definition (CommonMark §4.7): non-whitespace after the
 * destination that isn't a well-formed title means it was never a definition. An absent
 * title succeeds.
 */
function resolveTitle(
	afterUrl: string,
	lines: ParsedLine[],
	continuationLine: number,
	endIndex: number
): { title: string | undefined; titleLine: number | null } | null {
	if (afterUrl.length > 0) {
		const trailing = wholeLineTitle(afterUrl);
		if (!trailing) return null;
		return { title: trailing.title, titleLine: null };
	}
	if (continuationLine < endIndex) {
		const next = wholeLineTitle(stripLeadingSpaces(lines[continuationLine].text));
		if (next) return { title: next.title, titleLine: continuationLine };
	}
	return { title: undefined, titleLine: null };
}
