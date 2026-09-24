// Ambiguity with setext underlines is resolved in paragraph.ts; top-level
// dispatch only reaches here after a blank line or a non-paragraph state.

import { indentColumns } from '../lines';

export function matchThematicBreak(text: string): string | null {
	// CommonMark §4.1: 0-3 columns of indent; 4+ is indented code.
	if (indentColumns(text) >= 4) return null;
	const trimmed = text.trim();
	if (/^(\*[ \t]*){3,}$/.test(trimmed)) return '*';
	if (/^(-[ \t]*){3,}$/.test(trimmed)) return '-';
	if (/^(_[ \t]*){3,}$/.test(trimmed)) return '_';
	return null;
}
