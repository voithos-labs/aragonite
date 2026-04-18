/**
 * Pure Enter-at-cursor splice for code blocks. Computes the post-Enter
 * display text and cursor position for the two routes that bypass the
 * closed-fence "exit" / "blank line before closer" / "electric indent"
 * branches in `CodeBlock.svelte`:
 *
 * - `'normal'`  — plain Enter that just inserts a newline and replicates the
 *   current line's leading whitespace (the auto-indent default).
 * - `'soft'`    — Shift+Enter / mobile soft-keyboard `insertLineBreak`. Inserts
 *   a bare `\n` with no auto-indent, matching the universal "soft break"
 *   convention.
 *
 * No DOM, no Svelte. The orchestration layer reads display + selection from
 * the contenteditable, calls this, and writes the result back through
 * `updateBlockContent` + `pendingCursorOffset`.
 */

import { getLineLeadingWhitespace } from './code-editing';

export type CodeEnterMode = 'normal' | 'soft';

export interface CodeEnterInput {
	/** Current display text — the contenteditable's textContent. */
	display: string;
	/** Cursor / selection range. Collapsed when start === end. */
	selection: { start: number; end: number };
	/** `'normal'` for plain Enter (auto-indent), `'soft'` for Shift+Enter (no indent). */
	mode: CodeEnterMode;
}

export interface CodeEnterResult {
	/** New display text after the Enter splice. */
	newText: string;
	/** Caret position after the splice — sits just past the inserted indent. */
	newCursor: number;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Replace the selection with `\n` (plus, for `'normal'` mode, the current
 * line's leading whitespace) and return the new display + cursor. For
 * `'soft'` mode the inserted text is exactly `\n` — no indent — because
 * Shift+Enter is the explicit "soft break, no formatting" gesture.
 */
export function computeCodeEnter(input: CodeEnterInput): CodeEnterResult {
	const { display, selection, mode } = input;
	const { start, end } = selection;

	// Indent is read from the line containing the SELECTION START — Enter on
	// a non-collapsed range deletes the range first, so the surviving line
	// is the one that started the selection.
	const indent = mode === 'normal' ? getLineLeadingWhitespace(display, start) : '';
	const inserted = '\n' + indent;

	return {
		newText: display.slice(0, start) + inserted + display.slice(end),
		newCursor: start + inserted.length
	};
}
