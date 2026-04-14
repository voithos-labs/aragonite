/**
 * Link reference definition parser. Matches `[label]: url "title"` lines,
 * excluding footnote labels (labels starting with `^`).
 */

export function matchLinkReferenceDefinition(text: string): { label: string } | null {
	const m = text.match(/^ {0,3}\[([^\]]+)\]:\s+/);
	if (!m || m[1].startsWith('^')) return null;
	return { label: m[1] };
}
