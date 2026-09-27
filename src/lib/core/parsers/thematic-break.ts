// Ambiguity with setext underlines is resolved in paragraph.ts; top-level
// dispatch only reaches here after a blank line or a non-paragraph state.

import { indentColumns } from '../lines';

export function matchThematicBreak(text: string): string | null {
	// CommonMark §4.1: 0-3 columns of indent; 4+ is indented code. Only spaces and tabs may
	// sit around the markers, so a non-breaking space makes the line a paragraph.
	if (indentColumns(text) >= 4) return null;
	if (/^[ \t]*(\*[ \t]*){3,}$/.test(text)) return '*';
	if (/^[ \t]*(-[ \t]*){3,}$/.test(text)) return '-';
	if (/^[ \t]*(_[ \t]*){3,}$/.test(text)) return '_';
	return null;
}
