/**
 * Pure raw and caret transforms for TextEditableBlock's structural gestures: changing a
 * heading's level, demoting it to prose, inserting a hard break, inserting a literal tab.
 * The component owns the wiring; these own the string math.
 */

import { sameLineSuffixOf, type ContentRange } from '../../../core/inline';
import {
	displayLength,
	ownTrailingLineEnding,
	trailingLineEnding,
	trimTrailingLineEnding,
	type LineEnding
} from '../../../core/lines';

export interface TextEditResult {
	newRaw: string;
	caretOffset: number;
}

/**
 * Drop the block's structure outside its content range, the same range the check that let the
 * key through reads. Null where the content is the whole display.
 */
export function demoteToParagraph(
	raw: string,
	content: ContentRange,
	preEditOffset: number
): TextEditResult | null {
	if (content.start === 0 && content.end === displayLength(raw)) return null;
	const inContent = Math.min(Math.max(preEditOffset, content.start), content.end);
	return {
		newRaw: raw.slice(content.start, content.end) + endingPastContent(raw, content.end),
		caretOffset: inContent - content.start
	};
}

// The line ending the dropped structure ended in, a lone `\r` on a document's last line included.
function endingPastContent(raw: string, contentEnd: number): string {
	return /(?:\r\n?|\n)$/.exec(raw.slice(contentEnd))?.[0] ?? '';
}

/** An ATX heading with no text draws nothing when unfocused, so on blur it becomes the empty
 *  paragraph it looks like rather than a `#` that reappears on the next click. */
export function demoteEmptyAtxHeading(raw: string, content: ContentRange): TextEditResult | null {
	if (content.start === 0 || content.end > content.start) return null;
	return demoteToParagraph(raw, content, 0);
}

/** Re-mark the content with an ATX prefix for `level`, replacing the current kind's structural
 *  bytes. Not a toggle: level 0 demotes, and null there means there was nothing to strip. */
export function cycleHeading(
	raw: string,
	content: ContentRange,
	level: number,
	preEditOffset: number
): TextEditResult | null {
	if (level === 0) return demoteToParagraph(raw, content, preEditOffset);
	const prefix = '#'.repeat(level) + ' ';
	const newDisplay = prefix + raw.slice(content.start, content.end);
	const inContent = Math.min(Math.max(preEditOffset, content.start), content.end);
	return {
		newRaw: newDisplay + endingPastContent(raw, content.end),
		caretOffset: prefix.length + (inContent - content.start)
	};
}

/**
 * Insert a GFM hard break (a backslash at end of line) at `offset`. At the content's end, the
 * line ending after the content stands in for the break's own until the next key adds the line.
 */
export function insertHardBreak(
	raw: string,
	offset: number,
	ending: LineEnding,
	content: ContentRange
): TextEditResult {
	const display = trimTrailingLineEnding(raw);
	const trailing = ownTrailingLineEnding(raw);
	if (offset === content.end && content.end < display.length) {
		return {
			newRaw: raw.slice(0, content.end) + '\\' + raw.slice(content.end),
			caretOffset: content.end + 1
		};
	}
	const lineTail = sameLineSuffixOf(raw, content.end);
	if (offset >= content.start && offset < content.end && lineTail) {
		return breakBeforeLine(
			display.slice(0, offset) + '\\' + lineTail,
			display.slice(offset, content.end) + display.slice(content.end + lineTail.length)
		);
	}
	return breakBeforeLine(display.slice(0, offset) + '\\', display.slice(offset));

	/** `head`, the break's line ending, then `rest` on the new line. */
	function breakBeforeLine(head: string, rest: string): TextEditResult {
		// The break carries the block's own ending, else the document's `ending`: CommonMark reads
		// a backslash before either LF or CRLF as a hard break, so a CRLF block stays CRLF.
		const breakEnding = trailingLineEnding(raw, ending);
		const newDisplay = head + breakEnding + rest;
		// With nothing after the break, the inserted ending is itself the trailing ending;
		// reattaching the original would double it into a blank line and break list continuation.
		const newRaw = rest === '' ? newDisplay : newDisplay + trailing;
		return {
			newRaw,
			caretOffset: Math.min(head.length + breakEnding.length, displayLength(newRaw))
		};
	}
}

/** The key typed after a hard break's backslash, opening the break's own line at `lineEnd` (past a
 *  heading's closing run). Works on the display text, without its trailing line ending. */
export function openHardBreakLine(
	display: string,
	lineEnd: number,
	ending: LineEnding,
	key: string
): { display: string; caret: number } {
	const line = ending + key;
	return {
		display: display.slice(0, lineEnd) + line + display.slice(lineEnd),
		caret: lineEnd + line.length
	};
}

/** Insert a literal tab character at `offset` within the display portion. */
export function insertLiteralTab(raw: string, offset: number): TextEditResult {
	const display = trimTrailingLineEnding(raw);
	const trailing = ownTrailingLineEnding(raw);
	const newDisplay = display.slice(0, offset) + '\t' + display.slice(offset);
	return { newRaw: newDisplay + trailing, caretOffset: offset + 1 };
}
