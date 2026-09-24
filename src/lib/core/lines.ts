/** Line splitting preserving endings and offsets, plus the trailing-line-ending helpers. */

/**
 * GFM §2.1: a blank line holds nothing but spaces and tabs. Deliberately not `String.trim()`,
 * which admits all Unicode whitespace: a non-breaking space is content, and a line holding one
 * continues its block.
 */
const NON_BLANK_CHAR = /[^ \t]/;

export function isBlankLine(text: string): boolean {
	return !NON_BLANK_CHAR.test(text);
}

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
 * The ending `raw` actually carries, {@link trimTrailingLineEnding}'s complement.
 * {@link trailingLineEnding} answers a different question, which ending to give a block, so code
 * reattaching a block's own bytes reads this one (G4.20).
 */
export function ownTrailingLineEnding(raw: string): '' | '\n' | '\r\n' {
	return raw.slice(displayLength(raw)) as '' | '\n' | '\r\n';
}

/**
 * `offset` moved off the interior of a surrogate pair, back to the pair's start. Caret offsets
 * are UTF-16 code units, so a cut at one can halve an astral character and leave a lone
 * surrogate, which no UTF-8 encoder round-trips (`TextEncoder` yields U+FFFD) and no undo
 * restores. Code points only: a grapheme cluster is a rendering question, and snapping to one
 * would move a caret the author placed between two separate characters.
 */
export function snapToScalarBoundary(raw: string, offset: number): number {
	if (offset <= 0 || offset >= raw.length) return offset;
	const splitsPair =
		(raw.charCodeAt(offset - 1) & 0xfc00) === 0xd800 &&
		(raw.charCodeAt(offset) & 0xfc00) === 0xdc00;
	return splitsPair ? offset - 1 : offset;
}

/**
 * The block's authored trailing line ending. Every site that reattaches or creates one reads it
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

/** Every paste entry point goes through here, so the paste rules read LF whatever the clipboard
 *  held; the paste writes the document's own ending back (`tree-operations/paste/line-ending.ts`). */
export function normalizeLineEndings(text: string): string {
	return text.replace(/\r\n/g, '\n');
}

/** `text` with every line break written as `ending`: how LF text joins a document's own lines. */
export function withLineEnding(text: string, ending: '\n' | '\r\n'): string {
	return text.replace(/\r?\n/g, ending);
}

/** The ending of the line holding `offset`: the break closing it, else the nearest one before it.
 *  Null when `text` holds no line break at all. */
export function lineEndingAt(text: string, offset: number): '\n' | '\r\n' | null {
	const after = text.indexOf('\n', offset);
	const at = after >= 0 ? after : text.lastIndexOf('\n', offset);
	if (at < 0) return null;
	return text[at - 1] === '\r' ? '\r\n' : '\n';
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

// ── Indentation ──────────────────────────────────────────────────────────────

/** Columns of leading indentation, a tab advancing to the next multiple of four (GFM §2.2). */
export function indentColumns(text: string): number {
	let col = 0;
	for (const char of text) {
		if (char === ' ') col++;
		else if (char === '\t') col += 4 - (col % 4);
		else break;
	}
	return col;
}

/**
 * `text` with up to `columns` columns of indentation removed. A tab the cut splits, or one left
 * off a multiple of four, is written as the spaces it spans: the stripped line is a child's raw,
 * which every later reparse reads from column zero.
 */
export function stripIndentColumns(text: string, columns: number): string {
	const leadLength = text.length - text.replace(/^[ \t]+/, '').length;
	let col = 0;
	let cut = 0;
	while (cut < leadLength) {
		const width = text[cut] === '\t' ? 4 - (col % 4) : 1;
		if (col + width > columns) break;
		col += width;
		cut++;
	}
	const straddles = cut < leadLength && col < columns;
	const tabShifts = columns % 4 !== 0 && text.slice(cut, leadLength).includes('\t');
	if (!straddles && !tabShifts) return text.slice(cut);
	return ' '.repeat(indentColumns(text) - columns) + text.slice(leadLength);
}

/**
 * Rebuild a `ParsedLine[]` after a per-line strip, as the container parsers do when they reparse
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
