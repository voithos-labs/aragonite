/**
 * Where a line of a source string starts and ends, around a byte: the reads every range edit makes
 * of the bytes either side of a place. A `\r\n` ending counts as the line's end, never its text.
 */

/** The bytes from the start of the line holding `at` up to `at`. */
export const lineHead = (source: string, at: number) =>
	source.slice(source.lastIndexOf('\n', at - 1) + 1, at);

/** The text from `at` to the end of its line, the line ending left out. */
export const lineRest = (source: string, at: number) =>
	source.slice(at, lineEnd(source, at)).replace(/\r$/, '');

/** Where the line holding `at` ends, before its `\r\n` as well as its `\n`. */
export function lineEndBefore(source: string, at: number): number {
	const end = lineEnd(source, at);
	return source[end - 1] === '\r' && end > at ? end - 1 : end;
}

/** Where the line holding `at` ends: its `\n`, or the source's end. */
export function lineEnd(source: string, at: number): number {
	const end = source.indexOf('\n', at);
	return end < 0 ? source.length : end;
}
