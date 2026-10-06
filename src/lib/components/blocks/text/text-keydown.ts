/**
 * Pure text and caret transforms for TextEditableBlock's structural gestures: changing a
 * heading's level, demoting it to prose, inserting a hard break inside the text, inserting a
 * literal tab. The component owns the wiring; these own the string math.
 */

import { sameLineSuffixOf, type ContentRange } from '../../../core/inline';
import {
	displayLength,
	ownTrailingLineEnding,
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

/** A GFM hard break (a backslash at end of line) at `offset`, ended with `ending`, the typed break's;
 *  at the end of the text's line the pending break writes it instead (`cursor/pending-break.svelte.ts`). */
export function insertHardBreak(
	raw: string,
	offset: number,
	ending: LineEnding,
	content: ContentRange
): TextEditResult {
	const display = trimTrailingLineEnding(raw);
	const lineTail = sameLineSuffixOf(raw, content.end);
	const [head, rest] =
		offset >= content.start && offset < content.end && lineTail
			? [
					display.slice(0, offset) + '\\' + lineTail,
					display.slice(offset, content.end) + display.slice(content.end + lineTail.length)
				]
			: [display.slice(0, offset) + '\\', display.slice(offset)];
	const newDisplay = head + ending + rest;
	// Past a setext underline's end the inserted ending is the trailing one; a second would add a
	// blank line.
	const newRaw = rest === '' ? newDisplay : newDisplay + ownTrailingLineEnding(raw);
	return {
		newRaw,
		caretOffset: Math.min(head.length + ending.length, displayLength(newRaw))
	};
}

/** A literal tab typed at `offset` into the displayed text. */
export function insertLiteralTab(
	display: string,
	offset: number
): { text: string; caretAfter: number } {
	return { text: display.slice(0, offset) + '\t' + display.slice(offset), caretAfter: offset + 1 };
}
