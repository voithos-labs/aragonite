/**
 * Thematic break parser. Matches `---`, `***`, `___`.
 * Ambiguity with setext heading underlines is resolved inside paragraph
 * parsing — see paragraph.ts. At the top-level dispatch, thematic breaks
 * are recognized only after a blank line (guarded by parseNextBlock).
 */

/** Match a thematic break line; returns the marker character (`*`, `-`, `_`) or null. */
export function matchThematicBreak(text: string): string | null {
	const trimmed = text.trim();
	if (/^(\*[ \t]*){3,}$/.test(trimmed)) return '*';
	if (/^(-[ \t]*){3,}$/.test(trimmed)) return '-';
	if (/^(_[ \t]*){3,}$/.test(trimmed)) return '_';
	return null;
}
