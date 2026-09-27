// ATX headings only. Setext (`===` / `---` underline) lives in paragraph.ts
// because it emerges from paragraph continuation.

import type { AnyBlockKind } from '../nodes';
import { OPTIONAL_LINE_ENDING, displayLength, trimTrailingLineEnding } from '../lines';

export interface AtxHeadingMatch {
	level: number;
	/** The editable text's range in the line: past the hashes and one space or tab, and short of
	 *  the closing run with the one space or tab before it (GFM §4.2). */
	contentStart: number;
	contentEnd: number;
}

// GFM §4.2: the hashes end at a space, a tab or the line's end.
const OPENING = /^ {0,3}(#{1,6})(?:[ \t]|$)/;
const MAY_OPEN = /^ {0,3}#/;
const LINE_ENDING = new RegExp(`${OPTIONAL_LINE_ENDING}$`);

/** The ATX heading `text` opens, read once for every caller: the parser, the content range and
 *  the keys that rewrite a heading's marker. `text` may carry its line ending. */
export function matchHeading(text: string): AtxHeadingMatch | null {
	// Every parsed line comes through here, so a line that opens no heading costs no copy.
	if (!MAY_OPEN.test(text)) return null;
	// A document's last line may end in a lone `\r`, which a heading's own raw keeps as text.
	const line = text.replace(LINE_ENDING, '');
	const m = OPENING.exec(line);
	if (!m) return null;
	const contentStart = m[0].length;
	const contentEnd = closingRunStart(line, contentStart) ?? displayLength(text);
	return { level: m[1].length, contentStart, contentEnd };
}

/**
 * Where the optional closing sequence starts, or null without one: a run of `#`s preceded by a
 * space or tab and followed only by spaces and tabs, or content that is all `#`s. Whitespace with
 * no run after it stays content, so a space typed at the end is not swallowed.
 */
function closingRunStart(line: string, contentStart: number): number | null {
	let end = line.length;
	while (end > contentStart && isSpaceOrTab(line[end - 1])) end--;
	let run = end;
	while (run > contentStart && line[run - 1] === '#') run--;
	if (run === end) return null;
	if (run === contentStart) return contentStart;
	return isSpaceOrTab(line[run - 1]) ? run - 1 : null;
}

function isSpaceOrTab(ch: string): boolean {
	return ch === ' ' || ch === '\t';
}

/**
 * A heading whose bytes are its hashes alone: CommonMark's empty heading, and the state a line
 * passes through on the way to `#tag`. The parse keeps it a heading; what it shows as is
 * {@link shownKind}'s answer.
 */
export function isBareHeadingOpener(raw: string): boolean {
	const heading = matchHeading(raw);
	if (!heading) return false;
	const line = trimTrailingLineEnding(raw);
	return heading.contentStart === line.length && line.endsWith('#');
}

/**
 * The kind a block shows as: its own, except that a bare `#` keeps the paragraph's type until the
 * space after the hashes lands, so a line on its way to `#tag` never flashes to heading size.
 * Its paint, its accessible name and the kind cue all read this.
 */
export function shownKind(node: { kind: AnyBlockKind; raw: string }): AnyBlockKind {
	return node.kind === 'heading' && isBareHeadingOpener(node.raw) ? 'paragraph' : node.kind;
}
