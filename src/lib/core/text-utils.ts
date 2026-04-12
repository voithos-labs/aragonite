/**
 * Small text helpers used by both the core parser and the editor layer.
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
