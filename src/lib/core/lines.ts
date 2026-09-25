/**
 * Line splitting that keeps each line's ending and offsets, and the line-ending rule: a line the
 * editor writes takes the document's ending ({@link documentLineEnding}), and per-line work reads
 * each line's text without its ending ({@link displayLines}).
 */

import type { DocumentView } from './node-views';

export type LineEnding = '\n' | '\r\n';

/** GFM §2.1: a blank line holds only spaces and tabs; a non-breaking space is content. */
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

/** The ending `raw` actually carries, empty when it has none: {@link trimTrailingLineEnding}'s
 *  complement, for code reattaching a block's own bytes. */
export function ownTrailingLineEnding(raw: string): '' | LineEnding {
	return raw.slice(displayLength(raw)) as '' | LineEnding;
}

// ── The document's line ending ───────────────────────────────────────────────

const documentEndings = new WeakMap<DocumentView, LineEnding>();

/**
 * The ending every line the editor writes into `doc` takes: the document's first line break, else
 * LF. Remembered per document once found; a document holding no break yet is scanned again on
 * each call, so the first break a write (a paste, an Enter) introduces is the one the next reads.
 */
export function documentLineEnding(doc: DocumentView): LineEnding {
	const known = documentEndings.get(doc);
	if (known) return known;
	const found = firstDocumentBreak(doc);
	if (found) documentEndings.set(doc, found);
	return found ?? '\n';
}

function firstDocumentBreak(doc: DocumentView): LineEnding | null {
	let before = '';
	const chunks = [doc.prefix, ...doc.children.flatMap((c) => [c.leadingTrivia ?? '', c.raw])];
	for (const chunk of [...chunks, doc.suffix]) {
		const at = chunk.indexOf('\n');
		if (at >= 0) return (at > 0 ? chunk[at - 1] : before) === '\r' ? '\r\n' : '\n';
		if (chunk !== '') before = chunk[chunk.length - 1];
	}
	return null;
}

/** The first line break in `text`, or null when it holds none. In a document with one ending,
 *  any break in a block's own bytes is the document's. */
export function firstLineEnding(text: string): LineEnding | null {
	const at = text.indexOf('\n');
	if (at < 0) return null;
	return text[at - 1] === '\r' ? '\r\n' : '\n';
}

/**
 * The ending `raw` closes with, else `fallback`: what a line rebuilt from a block's bytes ends in.
 * A block with no ending of its own is the document's last line, so the fallback is usually the
 * document's ending ({@link documentLineEnding}).
 */
export function trailingLineEnding(raw: string, fallback: LineEnding): LineEnding {
	return ownTrailingLineEnding(raw) || fallback;
}

/** `text` closed with `ending` when its last line is open: a slice cut from a block would
 *  otherwise run into whatever follows it once the bytes stand alone. */
export function terminateLine(text: string, ending: LineEnding): string {
	return text.endsWith('\n') ? text : text + ending;
}

// ── Scalars ──────────────────────────────────────────────────────────────────

/** The first half of a UTF-16 surrogate pair, as a code unit (`charCodeAt`). */
export function isHighSurrogate(unit: number): boolean {
	return unit >= 0xd800 && unit <= 0xdbff;
}

/** The second half of a UTF-16 surrogate pair, as a code unit (`charCodeAt`). */
export function isLowSurrogate(unit: number): boolean {
	return unit >= 0xdc00 && unit <= 0xdfff;
}

/**
 * `offset` moved off the interior of a surrogate pair, back to the pair's start: a cut there
 * leaves a lone surrogate, which no UTF-8 encoder round-trips. Code points only, not graphemes.
 */
export function snapToScalarBoundary(raw: string, offset: number): number {
	if (offset <= 0 || offset >= raw.length) return offset;
	const splitsPair =
		isHighSurrogate(raw.charCodeAt(offset - 1)) && isLowSurrogate(raw.charCodeAt(offset));
	return splitsPair ? offset - 1 : offset;
}

// ── Splitting ────────────────────────────────────────────────────────────────

/** Every paste entry point goes through here, so the paste rules read LF whatever the clipboard
 *  held; the paste writes the document's own ending back. */
export function normalizeLineEndings(text: string): string {
	return text.replace(/\r\n/g, '\n');
}

/** `text` with every line break written as `ending`: how LF text joins a document's own lines. */
export function withLineEnding(text: string, ending: LineEnding): string {
	return text.replace(/\r?\n/g, ending);
}

/** The line break starting at `offset` in `text`, empty when none starts there. */
export function lineEndingAt(text: string, offset: number): '' | LineEnding {
	if (text[offset] === '\n') return '\n';
	return text.startsWith('\r\n', offset) ? '\r\n' : '';
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

export interface DisplayLine {
	text: string;
	ending: '' | LineEnding;
}

/**
 * A block's display (its bytes without the trailing ending) as lines, each line's text apart from
 * its ending. A display always has a last line, empty after a final break, and
 * {@link joinDisplayLines} puts the bytes back exactly.
 */
export function displayLines(display: string): DisplayLine[] {
	const lines: DisplayLine[] = splitLines(display).map((line) => ({
		text: line.text,
		ending: line.lineEnding as '' | LineEnding
	}));
	if (display === '' || display.endsWith('\n')) lines.push({ text: '', ending: '' });
	return lines;
}

export function joinDisplayLines(lines: readonly DisplayLine[]): string {
	return lines.map((line) => line.text + line.ending).join('');
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

/** A `ParsedLine[]` rebuilt after a per-line strip, offsets recomputed from the stripped bytes. */
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
