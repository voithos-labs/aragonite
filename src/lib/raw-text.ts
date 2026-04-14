/**
 * Editor-layer helpers for the CST node `raw` field's display vs storage distinction.
 * The parser writes `raw` with trailing line endings; the editor strips them to produce
 * the text the user sees in a contenteditable surface.
 */

/** Length of `raw` excluding any trailing line ending (LF or CRLF). */
export function displayLength(raw: string): number {
	if (raw.endsWith('\r\n')) return raw.length - 2;
	if (raw.endsWith('\n')) return raw.length - 1;
	return raw.length;
}

/** Return `raw` with any trailing line ending (LF or CRLF) removed. */
export function trimTrailingLineEnding(raw: string): string {
	return raw.slice(0, displayLength(raw));
}
