/**
 * Link reference definition parser. CommonMark §4.7 — `[label]: url "title"`,
 * with URL and optional title allowed on continuation lines.
 *
 * Footnote labels (`[^...]:`) are excluded — they parse as paragraphs.
 */

import type { CstNode } from '../nodes';
import type { ParsedLine } from '../lines';
import { ESCAPABLE_PUNCTUATION } from '../escapable';
import { joinRaw } from '../parser';
import { lineInterruptsParagraph } from '../../schema/block-openers';

export function parseLinkReferenceDefinition(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string
): { node: CstNode; nextIndex: number } | null {
	const first = lines[startIndex];
	const opener = matchLabelOpener(first.text);
	if (!opener) return null;
	const { label, afterColon } = opener;
	if (label.startsWith('^')) return null;

	// The destination sits on the definition line or the one after it; resolve which
	// first, then run one url + title tail regardless of which line it came from.
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
		nextIndex: lineCursor + 1
	};
}

function stripLeadingSpaces(s: string): string {
	return s.replace(/^[ \t]*/, '');
}

/**
 * The destination segment and the line it lives on. Same-line `[label]: url` uses the
 * definition line; an empty tail defers to the next line (CommonMark §4.7 allows one
 * line ending before the destination). Bare `[label]:` with no URL, a next line that
 * opens another block, or an empty next line all decline.
 */
function resolveDestinationSegment(
	afterColon: string,
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number
): { segment: string; segmentLine: number } | null {
	const sameLine = stripLeadingSpaces(afterColon);
	if (sameLine.length > 0) return { segment: sameLine, segmentLine: startIndex };

	const nextIndex = startIndex + 1;
	if (nextIndex >= endIndex) return null;
	const nextLine = lines[nextIndex];
	if (lineInterruptsParagraph(nextLine.text)) return null;
	const segment = stripLeadingSpaces(nextLine.text);
	if (segment.length === 0) return null;
	return { segment, segmentLine: nextIndex };
}

// CommonMark §4.7: brackets inside a label may be backslash-escaped. Walks one
// line for `[label]:` honoring escapes. Multi-line labels and unescaped-`[`
// rejection are out of scope (status quo of the line-oriented parser).
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
	if (j === labelStart) return null;
	return { label: line.slice(labelStart, j), afterColon: line.slice(j + 2) };
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

function matchTitleSingleLine(s: string): { title: string; consumed: number } | null {
	if (s.length === 0) return null;
	const ch = s[0];
	if (ch === '"' || ch === "'") {
		const close = s.indexOf(ch, 1);
		if (close === -1) return null;
		return { title: s.slice(1, close), consumed: close + 1 };
	}
	if (ch === '(') {
		const close = s.indexOf(')', 1);
		if (close === -1) return null;
		return { title: s.slice(1, close), consumed: close + 1 };
	}
	return null;
}

/**
 * Resolve the optional title after a destination. `null` invalidates the whole
 * definition (CommonMark §4.7): non-whitespace after the destination that isn't
 * a well-formed title — or a title trailed by junk — means it is not a
 * definition at all. An absent title (next line consumed, or nothing) succeeds.
 */
function resolveTitle(
	afterUrl: string,
	lines: ParsedLine[],
	continuationLine: number,
	endIndex: number
): { title: string | undefined; titleLine: number | null } | null {
	if (afterUrl.length > 0) {
		const parsed = parseTrailingTitle(afterUrl);
		if (parsed === undefined) return null;
		return { title: parsed, titleLine: null };
	}
	const next = consumeContinuationTitle(lines, continuationLine, endIndex);
	if (next) return { title: next.title, titleLine: next.lineIndex };
	return { title: undefined, titleLine: null };
}

function parseTrailingTitle(afterUrl: string): string | undefined {
	const t = matchTitleSingleLine(afterUrl);
	if (!t) return undefined;
	const trailing = stripLeadingSpaces(afterUrl.slice(t.consumed));
	return trailing.length === 0 ? t.title : undefined;
}

function consumeContinuationTitle(
	lines: ParsedLine[],
	lineIndex: number,
	endIndex: number
): { title: string; lineIndex: number } | null {
	if (lineIndex >= endIndex) return null;
	const stripped = stripLeadingSpaces(lines[lineIndex].text);
	if (stripped.length === 0) return null;
	const t = matchTitleSingleLine(stripped);
	if (!t) return null;
	const trailing = stripLeadingSpaces(stripped.slice(t.consumed));
	if (trailing.length !== 0) return null;
	return { title: t.title, lineIndex };
}
