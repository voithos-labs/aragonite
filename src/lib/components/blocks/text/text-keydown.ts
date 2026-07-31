/**
 * Pure raw/caret transforms for TextEditableBlock keydown branches — heading-level
 * swap, hard-break insertion, literal-tab insertion. The component owns the plumbing;
 * these own the string math.
 */

import { displayLength, trailingLineEnding, trimTrailingLineEnding } from '../../../core/lines';

export interface TextEditResult {
	newRaw: string;
	caretOffset: number;
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
