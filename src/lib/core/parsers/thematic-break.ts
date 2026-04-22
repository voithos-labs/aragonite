// Ambiguity with setext underlines is resolved in paragraph.ts; top-level
// dispatch only reaches here after a blank line or a non-paragraph state.

export function matchThematicBreak(text: string): string | null {
	const trimmed = text.trim();
	if (/^(\*[ \t]*){3,}$/.test(trimmed)) return '*';
	if (/^(-[ \t]*){3,}$/.test(trimmed)) return '-';
	if (/^(_[ \t]*){3,}$/.test(trimmed)) return '_';
	return null;
}
