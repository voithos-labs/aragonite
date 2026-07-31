/**
 * Pure Enter-at-cursor splice for code blocks. `'normal'` auto-indents from
 * the current line; `'soft'` (Shift+Enter / mobile `insertLineBreak`) inserts
 * the line ending alone.
 */

import { getLineLeadingWhitespace } from './code-editing';

export type CodeEnterMode = 'normal' | 'soft';

export interface CodeEnterInput {
	display: string;
	selection: { start: number; end: number };
	mode: CodeEnterMode;
	/** The block's own ending. Required rather than defaulted: a literal `\n` here
	 *  would leave a lone LF inside a CRLF body. */
	ending: '\n' | '\r\n';
}

export interface CodeEnterResult {
	newText: string;
	newCursor: number;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function computeCodeEnter(input: CodeEnterInput): CodeEnterResult {
	const { display, selection, mode, ending } = input;
	const { start, end } = selection;

	// Indent reads from the SELECTION START's line — Enter on a non-collapsed
	// range deletes the range first, so the surviving line is that one.
	const indent = mode === 'normal' ? getLineLeadingWhitespace(display, start) : '';
	const inserted = ending + indent;

	return {
		newText: display.slice(0, start) + inserted + display.slice(end),
		newCursor: start + inserted.length
	};
}
