/**
 * Pure text and caret transforms for TextEditableBlock's structural gestures: demoting an empty
 * heading, inserting a hard break inside the text, inserting a literal tab. The component owns the
 * wiring; these own the string math. A heading level's bytes are `tree-operations/heading-level.ts`.
 */

import { sameLineSuffixOf, withHardBreak, type ContentRange } from '../../../core/inline';
import { demoteToParagraph, type TextEditResult } from '../../../tree-operations/heading-level';
import {
	displayLength,
	ownTrailingLineEnding,
	trimTrailingLineEnding,
	type LineEnding
} from '../../../core/lines';

/** An ATX heading with no text draws nothing when unfocused, so on blur it becomes the empty
 *  paragraph it looks like rather than a `#` that reappears on the next click. */
export function demoteEmptyAtxHeading(raw: string, content: ContentRange): TextEditResult | null {
	if (content.start === 0 || content.end > content.start) return null;
	return demoteToParagraph(raw, content, 0);
}

/** A GFM hard break (a backslash at end of line) at `offset`, ended with `ending`, the typed break's;
 *  at the end of the text's line the pending break writes it instead (`caret/pending-break.svelte.ts`). */
export function insertHardBreak(
	raw: string,
	offset: number,
	ending: LineEnding,
	content: ContentRange
): TextEditResult {
	const display = trimTrailingLineEnding(raw);
	// Only a break inside the text has the text line's closing run to keep on that line.
	const suffix =
		offset >= content.start && offset < content.end
			? { start: content.end, end: content.end + sameLineSuffixOf(raw, content.end).length }
			: { start: offset, end: offset };
	const broken = withHardBreak(display, offset, suffix, ending);
	// Past a setext underline's end the inserted ending is the trailing one; a second would add a
	// blank line.
	const newRaw = offset >= display.length ? broken.text : broken.text + ownTrailingLineEnding(raw);
	return { newRaw, caretOffset: Math.min(broken.lineStart, displayLength(newRaw)) };
}

/** A literal tab typed at `offset` into the displayed text. */
export function insertLiteralTab(
	display: string,
	offset: number
): { text: string; caretAfter: number } {
	return { text: display.slice(0, offset) + '\t' + display.slice(offset), caretAfter: offset + 1 };
}
