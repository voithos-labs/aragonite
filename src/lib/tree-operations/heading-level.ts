/**
 * A heading level's bytes for one block, the one rule the in-block command and a range's command
 * share: re-marking the content with an ATX prefix, or demoting it to prose.
 */

import { getContentRange, isProseKind, sameLineSuffixOf, type ContentRange } from '../core/inline';
import { displayLength } from '../core/lines';
import type { NodeView } from '../core/node-views';
import { followsTaskMarker } from './list/task-paragraph';

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

/** Re-mark the content with an ATX prefix for `level`, keeping a closing `#` run. Not a toggle:
 *  level 0 demotes, and null there means there was nothing to strip. */
export function cycleHeading(
	raw: string,
	content: ContentRange,
	level: number,
	preEditOffset: number
): TextEditResult | null {
	if (level === 0) return demoteToParagraph(raw, content, preEditOffset);
	const prefix = '#'.repeat(level) + ' ';
	const suffix = sameLineSuffixOf(raw, content.end);
	const newDisplay = prefix + raw.slice(content.start, content.end) + suffix;
	const inContent = Math.min(Math.max(preEditOffset, content.start), content.end);
	return {
		newRaw: newDisplay + endingPastContent(raw, content.end + suffix.length),
		caretOffset: prefix.length + (inContent - content.start)
	};
}

/** The level a heading command's argument names: one out of range, from the untrusted keybinding
 *  channel, strips the heading rather than throwing inside `repeat`. */
export function headingLevelOf(arg: unknown): number {
	return typeof arg === 'number' && arg >= 0 && arg <= 6 ? arg : 0;
}

export interface HeadingWrite extends TextEditResult {
	/** A to-do's text: the block is replaced whole, since a `# ` written after a box stays text. */
	replacesBlock: boolean;
}

/** What a heading level writes over `node`, child `index` of `parent`, one rule for a caret and a
 *  range. Null for a block with no prose, or a level 0 with nothing to strip. */
export function headingWrite(
	node: NodeView,
	parent: NodeView | null,
	index: number,
	level: number,
	offset: number
): HeadingWrite | null {
	if (!isProseKind(node.kind)) return null;
	const cycled = cycleHeading(node.raw, getContentRange(node), level, offset);
	return cycled && { ...cycled, replacesBlock: followsTaskMarker(parent ?? undefined, index) };
}
