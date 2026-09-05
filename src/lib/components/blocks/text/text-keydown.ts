/**
 * Pure raw/caret transforms for TextEditableBlock keydown branches — heading-level
 * swap, demotion to prose, hard-break insertion, literal-tab insertion. The component
 * owns the plumbing; these own the string math.
 */

import type { ContentRange } from '../../../core/inline';
import {
	displayLength,
	ownTrailingLineEnding,
	trailingLineEnding,
	trimTrailingLineEnding
} from '../../../core/lines';

export interface TextEditResult {
	newRaw: string;
	caretOffset: number;
}

/**
 * Give up the block's own structural bytes, whichever end the kind keeps them at: a prefix for
 * ATX, an underline line for setext. Both sides read the kind's CONTENT RANGE and nothing else, so
 * a prefix rewrite cannot disagree with the gate that let the press through (`  ## x` is a heading
 * whose `#`s a `^#` regex never reaches). Null where the content IS the whole display.
 */
export function demoteToParagraph(
	raw: string,
	content: ContentRange,
	preEditOffset: number
): TextEditResult | null {
	if (content.start > 0) return dropStructuralPrefix(raw, content.start, preEditOffset);
	if (content.end < displayLength(raw))
		return dropStructuralSuffix(raw, content.end, preEditOffset);
	return null;
}

/** Drop everything before `contentStart` — a heading's marker prefix and any spaces that precede
 *  it, which sit before every caret the content range admits. */
export function dropStructuralPrefix(
	raw: string,
	contentStart: number,
	preEditOffset: number
): TextEditResult {
	return {
		newRaw: raw.slice(contentStart),
		caretOffset: Math.max(0, preEditOffset - contentStart)
	};
}

/** Drop everything past `contentEnd` but the block's own trailing line ending — the setext
 *  underline, which sits after every caret the content range admits. */
export function dropStructuralSuffix(
	raw: string,
	contentEnd: number,
	preEditOffset: number
): TextEditResult {
	return {
		newRaw: raw.slice(0, contentEnd) + ownTrailingLineEnding(raw),
		caretOffset: Math.min(preEditOffset, contentEnd)
	};
}

/**
 * Re-mark the block's CONTENT with an ATX prefix for `level`, replacing whatever structural bytes
 * the current kind keeps — the same content range {@link demoteToParagraph} reads, so an indented
 * `  ## x` or a setext underline is given up rather than left in the new heading's text.
 * `level === 0` IS the demotion, and null there means the content already is the whole display.
 * Idempotent, not a toggle: stripping is reached only by asking for level 0.
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
		newRaw: newDisplay + ownTrailingLineEnding(raw),
		caretOffset: prefix.length + (inContent - content.start)
	};
}

/**
 * Insert a GFM hard-break (a backslash at end of line) at `offset` within the display.
 * At end-of-display the break's own ending becomes the block's trailing ending, so the
 * break is transitional there until the next keystroke supplies its following line.
 */
export function insertHardBreak(raw: string, offset: number): TextEditResult {
	const display = trimTrailingLineEnding(raw);
	const trailing = ownTrailingLineEnding(raw);
	// The break carries the block's own ending (G4.20): CommonMark reads a backslash
	// before either LF or CRLF as a hard break, so a CRLF block stays CRLF.
	const breakBytes = '\\' + trailingLineEnding(raw);
	const newDisplay = display.slice(0, offset) + breakBytes + display.slice(offset);
	// At end-of-display the inserted ending is itself the trailing ending; reattaching
	// the original would double it into a blank line and break list-item continuation.
	const newRaw = offset >= display.length ? newDisplay : newDisplay + trailing;
	return {
		newRaw,
		caretOffset: Math.min(offset + breakBytes.length, displayLength(newRaw))
	};
}

/** Insert a literal tab character at `offset` within the display portion. */
export function insertLiteralTab(raw: string, offset: number): TextEditResult {
	const display = trimTrailingLineEnding(raw);
	const trailing = ownTrailingLineEnding(raw);
	const newDisplay = display.slice(0, offset) + '\t' + display.slice(offset);
	return { newRaw: newDisplay + trailing, caretOffset: offset + 1 };
}
