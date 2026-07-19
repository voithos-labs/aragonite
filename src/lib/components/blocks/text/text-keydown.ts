/**
 * Pure raw/caret transforms for TextEditableBlock keydown branches that
 * never read framework state — heading-level swap, hard-break insertion,
 * literal-tab insertion. The component owns DOM/effect plumbing; these
 * helpers own the string math.
 */

import { displayLength, trimTrailingLineEnding } from '../../../core/lines';

export interface TextEditResult {
	newRaw: string;
	caretOffset: number;
}

/**
 * Replace any leading `#{1,6} ` heading prefix with one for `level`.
 * `level === 0` strips an existing prefix without adding a new one.
 * Idempotent when the requested level matches the current prefix — it does not
 * toggle off; stripping is reached only by asking for level 0.
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
 * Insert a GFM hard-break (`\\\n`) at `offset` within the display portion. At
 * end-of-display the inserted `\n` becomes the block's trailing ending, so the
 * break is transitional there — a literal trailing `\` until the next keystroke
 * supplies its following line. The caret lands at the start of the continuation
 * line, clamped to the new display length so it is valid immediately.
 */
export function insertHardBreak(raw: string, offset: number): TextEditResult {
	const display = trimTrailingLineEnding(raw);
	const trailing = raw.slice(displayLength(raw));
	const newDisplay = display.slice(0, offset) + '\\\n' + display.slice(offset);
	// At end-of-display the inserted `\n` is itself the trailing ending; reattaching
	// the original would double it into a blank line and break list-item continuation.
	const newRaw = offset >= display.length ? newDisplay : newDisplay + trailing;
	return { newRaw, caretOffset: Math.min(offset + 2, displayLength(newRaw)) };
}

/** Insert a literal tab character at `offset` within the display portion. */
export function insertLiteralTab(raw: string, offset: number): TextEditResult {
	const display = trimTrailingLineEnding(raw);
	const trailing = raw.slice(displayLength(raw));
	const newDisplay = display.slice(0, offset) + '\t' + display.slice(offset);
	return { newRaw: newDisplay + trailing, caretOffset: offset + 1 };
}
