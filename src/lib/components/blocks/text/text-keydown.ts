/**
 * Pure raw/caret transforms for TextEditableBlock keydown branches — heading-level
 * swap, demotion to prose, hard-break insertion, literal-tab insertion. The component
 * owns the plumbing; these own the string math.
 */

import type { ContentRange } from '../../../core/inline';
import { displayLength, trailingLineEnding, trimTrailingLineEnding } from '../../../core/lines';

export interface TextEditResult {
	newRaw: string;
	caretOffset: number;
}

/**
 * Give up the block's own structural bytes, whichever end the kind keeps them at: a prefix for
 * ATX, an underline line for setext. Both sides read the kind's CONTENT RANGE and nothing else —
 * a prefix rewrite with a syntax of its own disagrees with the gate that let the press through
 * (`  ## x` is a heading whose `#`s a `^#` regex never reaches, and the demote wrote the block
 * back unchanged there). Null for a kind whose content IS its whole display: nothing to give up,
 * and the merge cascade takes the press.
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
		newRaw: raw.slice(0, contentEnd) + raw.slice(displayLength(raw)),
		caretOffset: Math.min(preEditOffset, contentEnd)
	};
}

/**
 * Replace any leading `#{1,6} ` prefix with one for `level`; `level === 0` strips it.
 * Idempotent, not a toggle — stripping is reached only by asking for level 0.
 */
export function cycleHeading(raw: string, level: number, preEditOffset: number): TextEditResult {
	const display = trimTrailingLineEnding(raw);
	const trailing = raw.slice(displayLength(raw));

	const oldPrefixMatch = display.match(/^#{1,6}\s?/);
	const oldPrefixLen = oldPrefixMatch ? oldPrefixMatch[0].length : 0;
	const stripped = display.slice(oldPrefixLen);
	const newPrefix = level === 0 ? '' : '#'.repeat(level) + ' ';
	const newDisplay = newPrefix + stripped;
	const caretOffset = newPrefix.length + Math.max(0, preEditOffset - oldPrefixLen);

	return { newRaw: newDisplay + trailing, caretOffset };
}

/**
 * Insert a GFM hard-break (a backslash at end of line) at `offset` within the display.
 * At end-of-display the break's own ending becomes the block's trailing ending, so the
 * break is transitional there until the next keystroke supplies its following line.
 */
export function insertHardBreak(raw: string, offset: number): TextEditResult {
	const display = trimTrailingLineEnding(raw);
	const trailing = raw.slice(displayLength(raw));
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
	const trailing = raw.slice(displayLength(raw));
	const newDisplay = display.slice(0, offset) + '\t' + display.slice(offset);
	return { newRaw: newDisplay + trailing, caretOffset: offset + 1 };
}
