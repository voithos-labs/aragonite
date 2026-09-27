/**
 * Pure raw and caret transforms for TextEditableBlock's structural gestures: changing a
 * heading's level, demoting it to prose, inserting a hard break, inserting a literal tab.
 * The component owns the wiring; these own the string math.
 */

import type { ContentRange } from '../../../core/inline';
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
 * Give up the block's own structural bytes at both ends: an ATX heading's `# ` and closing run, a
 * setext underline. Reads the kind's content range and nothing else, so the rewrite cannot
 * disagree with the check that let the key through. Null where the content is the whole display.
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

/**
 * An ATX heading left with no text is a marker standing over nothing: unfocused it draws
 * nothing, since the marker-only data attribute only applies while focused, so the block would
 * survive invisibly and come back as a `#` on the next click. On blur it becomes the empty
 * paragraph it looks like.
 */
export function demoteEmptyAtxHeading(raw: string, content: ContentRange): TextEditResult | null {
	if (content.start === 0 || content.end > content.start) return null;
	return demoteToParagraph(raw, content, 0);
}

/**
 * Re-mark the block's content with an ATX prefix for `level`, replacing whatever structural bytes
 * the current kind keeps. It reads the same content range {@link demoteToParagraph} does, so an
 * indented `  ## x` or a setext underline is given up rather than left in the new heading's text.
 * `level === 0` is the demotion, and null there means the content already is the whole displayed
 * text. Idempotent, not a toggle: stripping happens only by asking for level 0.
 */
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
 * Insert a GFM hard-break (a backslash at end of line) at `offset` within the display. At the
 * content end the break has no following line yet: the line break after the content (the block's
 * own ending, or the one above a setext underline) stands in for the break's until the next
 * keystroke supplies the line. Inside the text, structure on the text's own line (a heading's
 * closing run) stays on that line, before the break.
 */
export function insertHardBreak(
	raw: string,
	offset: number,
	ending: LineEnding,
	contentEnd: number
): TextEditResult {
	const display = trimTrailingLineEnding(raw);
	const trailing = ownTrailingLineEnding(raw);
	if (offset === contentEnd && contentEnd < display.length) {
		return {
			newRaw: raw.slice(0, contentEnd) + '\\' + raw.slice(contentEnd),
			caretOffset: contentEnd + 1
		};
	}
	const suffix = display.slice(contentEnd);
	if (offset < contentEnd && suffix && !/^[\r\n]/.test(suffix)) {
		return breakBeforeLine(
			display.slice(0, offset) + '\\' + suffix,
			display.slice(offset, contentEnd)
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

/** Insert a literal tab character at `offset` within the display portion. */
export function insertLiteralTab(raw: string, offset: number): TextEditResult {
	const display = trimTrailingLineEnding(raw);
	const trailing = ownTrailingLineEnding(raw);
	const newDisplay = display.slice(0, offset) + '\t' + display.slice(offset);
	return { newRaw: newDisplay + trailing, caretOffset: offset + 1 };
}
