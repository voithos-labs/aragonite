// Ambiguity with setext underlines is resolved in paragraph.ts; top-level
// dispatch only reaches here after a blank line or a non-paragraph state.

import { indentColumns, OPTIONAL_LINE_ENDING } from '../lines';

// CommonMark §4.1: only spaces and tabs sit around the markers, so a non-breaking space makes the
// line a paragraph.
const breakOf = (marker: string): RegExp =>
	new RegExp(`^[ \\t]*(?:\\${marker}[ \\t]*){3,}${OPTIONAL_LINE_ENDING}$`);
const BREAKS: [RegExp, string][] = [
	[breakOf('*'), '*'],
	[breakOf('-'), '-'],
	[breakOf('_'), '_']
];

export function matchThematicBreak(text: string): string | null {
	// 0-3 columns of indent; 4+ is indented code.
	if (indentColumns(text) >= 4) return null;
	for (const [pattern, marker] of BREAKS) if (pattern.test(text)) return marker;
	return null;
}
