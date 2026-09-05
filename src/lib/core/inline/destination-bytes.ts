/**
 * The scan's inverse for the two fields every bracketed construct hides: a destination and a
 * title. One home so the image and link write seams cannot drift apart on what needs escaping —
 * the sibling-path shape that put an unencoded space in one seam and not the other.
 */

// Bare destinations end at whitespace/`"`/`'` and carry parens only in balanced pairs
// (CommonMark §6.3); a trailing backslash would escape the closer instead. Idempotent: an
// encoded URL has no literal stop-char left.
export function encodeDestination(url: string): string {
	return url.replace(
		/[ \t\r\n()"'\\]/g,
		(c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')
	);
}

export function escapeTitle(title: string): string {
	return title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
