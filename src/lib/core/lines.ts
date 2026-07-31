/** Line splitting preserving endings and offsets, plus the trailing-line-ending helpers. */

/** Length of `raw` excluding any trailing line ending (LF or CRLF). */
export function displayLength(raw: string): number {
	if (raw.endsWith('\r\n')) return raw.length - 2;
	if (raw.endsWith('\n')) return raw.length - 1;
	return raw.length;
}

export function trimTrailingLineEnding(raw: string): string {
	return raw.slice(0, displayLength(raw));
}

/**
 * The block's authored trailing line ending. Every site that reattaches or mints one reads it
 * here (G4.20), so a CRLF-authored block keeps its ending and an unterminated one gets `\n`.
 */
export function trailingLineEnding(raw: string): '\n' | '\r\n' {
	return raw.endsWith('\r\n') ? '\r\n' : '\n';
}

/**
 * Keep a truncated slice line-terminated, borrowing `sourceRaw`'s own ending (G4.20). A slice
 * whose last line stays open swallows whatever follows it once the bytes stand alone.
 */
export function terminateLine(text: string, sourceRaw: string): string {
	return text.endsWith('\n') ? text : text + trailingLineEnding(sourceRaw);
}

/** Paste entry points funnel through here so Windows CRLF does not leak into a note. */
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

	if (start < source.length) {
		const raw = source.slice(start);
		lines.push({ raw, text: raw, lineEnding: '', start, end: source.length });
	}

	return lines;
}

/**
 * Re-mint a `ParsedLine[]` after a per-line strip, as the container parsers do when they reparse
 * a prefix-stripped body. Recompute, not spread: reusing an input line's offsets after shortening
 * its text desyncs the offsets from the bytes.
 */
export function remapStrippedLines(
	lines: ParsedLine[],
	stripLine: (line: ParsedLine, index: number) => string
): ParsedLine[] {
	let offset = 0;
	return lines.map((line, index) => {
		const text = stripLine(line, index);
		const raw = text + line.lineEnding;
		const stripped: ParsedLine = {
			raw,
			text,
			lineEnding: line.lineEnding,
			start: offset,
			end: offset + raw.length
		};
		offset += raw.length;
		return stripped;
	});
}
