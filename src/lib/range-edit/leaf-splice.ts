/**
 * Putting a text block's new bytes back into the source: the host's in-block writes answer in the
 * block's own bytes, its container markers stripped, and the changed part goes back behind the
 * markers of the lines it lands on.
 */

import { displayLines, isBlankText } from '../core/lines';
import { sharedPrefixLength, sharedSuffixLength } from '../core/written-span';
import type { LeafWrite } from './host';
import type { LaidBlock } from './layout';
import { endingOf, nodeAt, type Doc } from './document';
import { continuation } from './markers';

/** New bytes for the whole document and the caret's byte in them. */
export interface Edit {
	source: string;
	caret: number;
}

/** Where offset `at` of a text block's bytes sits in the source; past its last line ending is the
 *  block's end, which the map can't name (it is where the next line starts, behind its markers). */
export function byteAt(doc: Doc, leaf: LaidBlock, at: number): number {
	const raw = nodeAt(doc, leaf.path).raw;
	if (at > 0 && at === raw.length && raw.endsWith('\n')) return leaf.to;
	return doc.layout.byteOf(leaf.path, at)!;
}

/** Where the block's text starts on the line holding its offset `at`: past that line's markers
 *  and, on its first line, the block's own opening (a heading's `# `, a title row's `:::note `). */
export function lineTextStart(doc: Doc, leaf: LaidBlock, at: number): number {
	const raw = nodeAt(doc, leaf.path).raw;
	return Math.max(byteAt(doc, leaf, raw.lastIndexOf('\n', at - 1) + 1), leaf.text!.from);
}

/** `write` replaced `[from, to)` of the block's bytes: what changed goes into the source, each new
 *  line behind the markers of the line it lands on. */
export function writeLeaf(
	doc: Doc,
	leaf: LaidBlock,
	write: LeafWrite,
	from: number,
	to: number,
	keep?: (c: LaidBlock) => boolean
): Edit {
	const raw = nodeAt(doc, leaf.path).raw;
	const { bytes } = write;
	const head = sharedPrefixLength(raw, bytes, Math.min(from, bytes.length));
	const tail = sharedSuffixLength(raw, bytes, Math.min(raw.length - to, bytes.length - head));
	const start = byteAt(doc, leaf, head);
	const end = byteAt(doc, leaf, raw.length - tail);
	const text = spliced(doc, start, end, keep);
	const middle = text(bytes.slice(head, bytes.length - tail));
	const source = doc.source.slice(0, start) + middle + doc.source.slice(end);
	const caret =
		write.caret <= head
			? byteAt(doc, leaf, write.caret)
			: write.caret >= bytes.length - tail
				? byteAt(doc, leaf, raw.length - (bytes.length - write.caret)) +
					middle.length -
					(end - start)
				: start + text(bytes.slice(head, write.caret)).length;
	return { source, caret };
}

/** Text going in at `start` (up to `end`) in the document's line ending, each later line behind
 *  the markers there; a blank one takes them without trailing spaces unless the caret's text follows. */
export function spliced(doc: Doc, start: number, end: number, keep?: (c: LaidBlock) => boolean) {
	const eol = endingOf(doc.source);
	const rest = lineRest(doc.source, end);
	const prefix = continuation(doc, start, keep);
	return (text: string) =>
		displayLines(text)
			.map(({ text: line }, i, lines) => {
				if (i === 0) return line;
				const blank = line === '' && !(i === lines.length - 1 && !isBlankText(rest));
				return (blank ? prefix.trimEnd() : prefix) + line;
			})
			.join(eol);
}

export const lineHead = (source: string, at: number) =>
	source.slice(source.lastIndexOf('\n', at - 1) + 1, at);

/** The text from `at` to the end of its line, the line ending left out. */
export const lineRest = (source: string, at: number) =>
	source.slice(at, lineEnd(source, at)).replace(/\r$/, '');

/** Where the line holding \`at\` ends, before its \`\r\n\` as well as its \`\n\`. */
export function lineEndBefore(source: string, at: number): number {
	const end = lineEnd(source, at);
	return source[end - 1] === '\r' && end > at ? end - 1 : end;
}

export function lineEnd(source: string, at: number): number {
	const end = source.indexOf('\n', at);
	return end < 0 ? source.length : end;
}
