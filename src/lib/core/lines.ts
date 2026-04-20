/**
 * Line splitting with preserved endings and offsets for the parser,
 * plus the trailing-line-ending helpers shared between the parser and
 * the editor layer. These live in core/ because "what is the display
 * length of a raw string?" is a parser-level concept about the raw/text
 * distinction, not an editor-layer concern.
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

/**
 * Normalize clipboard or external text to LF line endings. The CST stores
 * pasted content with whatever line ending was provided, so platform drift
 * (Windows clipboards deliver CRLF) would otherwise leak CRLF into notes
 * and break byte-level cross-platform consistency. All paste entry points
 * funnel incoming text through this helper before parsing.
 */
export function normalizeLineEndings(text: string): string {
	return text.replace(/\r\n/g, '\n');
}

export interface ParsedLine {
	raw: string;
	text: string;
	lineEnding: string;
	start: number;
	end: number;
}

export function splitLines(source: string): ParsedLine[] {
	const lines: ParsedLine[] = [];
	let start = 0;

	for (let i = 0; i < source.length; i++) {
		if (source[i] === '\n') {
			const raw = source.slice(start, i + 1);
			const lineEnding = source[i - 1] === '\r' ? '\r\n' : '\n';
			const text = raw.slice(0, raw.length - lineEnding.length);
			lines.push({ raw, text, lineEnding, start, end: i + 1 });
			start = i + 1;
		}
	}

	// Remaining content after last newline (or entire string if no newlines)
	if (start < source.length) {
		const raw = source.slice(start);
		lines.push({ raw, text: raw, lineEnding: '', start, end: source.length });
	}

	return lines;
}
