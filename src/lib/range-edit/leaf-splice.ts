/**
 * Putting a text block's new bytes back into the source: the host's in-block writes answer in the
 * block's own bytes, its container markers stripped, and the changed part goes back behind the
 * markers of the lines it lands on. A write or a paste that leaves a block blank gives up the blank
 * line under it, as the block's emptying write does (`blankedApart`).
 */

import { displayLines, isBlankText, ownTrailingLineEnding } from '../core/lines';
import { sharedPrefixLength, sharedSuffixLength } from '../core/written-span';
import type { Joined, LeafWrite } from './host';
import type { LaidBlock } from './layout';
import { isCell, lineOf, nodeAt, parentOf, titleOwner, type Doc } from './document';
import { lineEnd, lineRest } from './lines';
import { continuation } from './markers';

/** New bytes for the whole document and the caret's byte in them. */
export interface Edit {
	source: string;
	caret: number;
	/** Set where the edit is one write of one text block: the block, its finished bytes and the
	 *  caret in them. */
	leaf?: LeafEdit;
	/** For a paste that read the clipboard as blocks and landed it so: how many it read. */
	blocks?: number;
	/** Set where a paste's last line ending was Enter: the caret is on the line it opened. */
	entered?: true;
}

/** One text block's finished bytes, as its own write stores them, and the caret's offset there. */
export interface LeafEdit {
	path: readonly number[];
	raw: string;
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

/** `text` over `[from, to)` of a text block's bytes, as the block's own write puts it there. */
export function writeText(
	doc: Doc,
	leaf: LaidBlock,
	from: number,
	to: number,
	text: string,
	keep?: (c: LaidBlock) => boolean
): Edit {
	const { host, tree, mode } = doc;
	const write =
		from === to
			? host.leaf.insert(tree, leaf.path, from, text, mode)
			: host.leaf.replace(tree, leaf.path, from, to, text, mode);
	return writtenText(doc, leaf, write, from, to, keep);
}

/** `write`, the block's own write over `[from, to)` of its bytes, landed in the source, the block
 *  named where the caret stays on its text. */
export function writtenText(
	doc: Doc,
	leaf: LaidBlock,
	write: LeafWrite,
	from: number,
	to: number,
	keep?: (c: LaidBlock) => boolean
): Edit {
	const written = writeLeaf(doc, leaf, write, from, to, keep);
	const edit = isBlankText(write.bytes) ? blankedApart(doc, leaf, written) : written;
	// A caret past the block's last line ending stands on no text of it, so the write names none.
	if (write.caret === write.bytes.length && write.bytes.endsWith('\n')) return edit;
	return { ...edit, leaf: { path: leaf.path, ...inDocumentEnding(doc, leaf, write, from, to) } };
}

/** `edit`, which left `leaf`, a block of `doc`, blank: less the blank line under it where text
 *  follows in its container; under an opening line of its own that line moves above it. */
export function blankedApart(doc: Doc, leaf: LaidBlock, edit: Edit): Edit {
	const { source } = doc;
	if (isBlankText(nodeAt(doc, leaf.path).raw) || isCell(doc, leaf) || titleOwner(doc, leaf))
		return edit;
	const next = textSibling(doc, leaf, 1);
	const lineStart = (at: number) => source.lastIndexOf('\n', at - 1) + 1;
	if (!next || lineStart(next.from) <= leaf.to) return edit;
	const shift = edit.source.length - source.length;
	const [under, below] = [leaf.to + shift, lineEnd(source, leaf.to) + 1 + shift];
	const out = edit.source;
	if (!underOpenerLine(doc, leaf))
		return { ...edit, source: out.slice(0, under) + out.slice(below) };
	const head = lineStart(leaf.from);
	const line = out.slice(under, below);
	return {
		...edit,
		source: out.slice(0, head) + line + out.slice(head, under) + out.slice(below),
		caret: edit.caret >= head ? edit.caret + line.length : edit.caret
	};
}

/** The nearest sibling of `leaf` with text, `step` away and on in that direction. */
function textSibling(doc: Doc, leaf: LaidBlock, step: 1 | -1): LaidBlock | undefined {
	const parent = leaf.path.slice(0, -1);
	let at: LaidBlock | undefined;
	for (let i = leaf.path.at(-1)! + step; (at = doc.layout.block([...parent, i])); i += step)
		if (!isBlankText(nodeAt(doc, at.path).raw)) return at;
	return undefined;
}

/** Whether no text stands between `leaf` and its container's opening line of its own (a callout's
 *  `[!NOTE]`, a title row), whose body reads the blank line under it as its own. */
function underOpenerLine(doc: Doc, leaf: LaidBlock): boolean {
	const above = textSibling(doc, leaf, -1);
	if (above) return titleOwner(doc, above) !== undefined;
	const parent = parentOf(doc, leaf);
	return !!parent?.lineAt && lineOf(parent, parent.from).own;
}

/** `write`'s bytes and caret with the line breaks it put over `[from, to)` in the document's line
 *  ending, as the source holds them; the block's own endings stay. */
function inDocumentEnding(
	doc: Doc,
	leaf: LaidBlock,
	write: LeafWrite,
	from: number,
	to: number
): Pick<LeafEdit, 'raw' | 'caret'> {
	const { bytes, caret } = write;
	if (doc.ending === '\n') return { raw: bytes, caret };
	const raw = nodeAt(doc, leaf.path).raw;
	const head = sharedPrefixLength(raw, bytes, Math.min(from, bytes.length));
	const tail = sharedSuffixLength(raw, bytes, Math.min(raw.length - to, bytes.length - head));
	const ended = (text: string) => text.replace(/\r?\n/g, doc.ending);
	const end = bytes.length - tail;
	const written = ended(bytes.slice(head, end));
	const grown = written.length - (end - head);
	const at =
		caret <= head
			? caret
			: caret >= end
				? caret + grown
				: head + ended(bytes.slice(head, caret)).length;
	return { raw: bytes.slice(0, head) + written + bytes.slice(end), caret: at };
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

/** A text block cut in two for a paste, as the source's bytes either side of the cut. */
export interface Cut {
	/** The source through the first half's end. */
	head: string;
	/** The source from the cut on: the second half, behind its line break where it starts a later
	 *  line of the block. */
	rest: string;
	/** Whether text of the block follows the cut on its line. */
	follows: boolean;
	/** Whether text was joined to the second half, and where it ends in `rest`. */
	joined: boolean;
	caret: number;
	/** The second half in the block's own bytes, and whether the block is left with no text. */
	tail: string;
	empty: boolean;
}

/** The block cut at `[from, to)` of its bytes as the host cuts it, the text of `joined` on its
 *  halves. */
export function cutLeaf(doc: Doc, leaf: LaidBlock, from: number, to: number, joined: Joined): Cut {
	const { before, after } = joined;
	// A block with no text is cut by its bytes: it holds no run and no structure past a text.
	if (leaf.text!.from === leaf.text!.to && from === to) {
		const at = byteAt(doc, leaf, from);
		const lines = spliced(doc, at, at, undefined, '', true);
		const [first, last] = [lines(before), lines(after)];
		return {
			head: doc.source.slice(0, at) + first,
			rest: last + doc.source.slice(at),
			follows: after !== '' || !isBlankText(lineRest(doc.source, at)),
			joined: after !== '',
			caret: last.length,
			tail: after + doc.source.slice(at, leaf.to),
			empty: before + after === ''
		};
	}
	const cut = doc.host.leaf.cut(doc.tree, leaf.path, from, to, joined, doc.mode);
	const raw = nodeAt(doc, leaf.path).raw;
	const ending = ownTrailingLineEnding(raw);
	// A cut at the end of a line the block goes on under leaves that line break as it is written.
	const cutAt = byteAt(doc, leaf, to);
	const nextBreak = after === '' && cutAt < leaf.text!.to ? /^\r?\n/.exec(raw.slice(to)) : null;
	const below = nextBreak !== null;
	const lineStart = /\n$/.test(cut.head);
	const sep = lineStart ? '' : (nextBreak?.[0] ?? '\n');
	const bytes = cut.head + sep + cut.tail + ending;
	const { source } = writeLeaf(doc, leaf, { bytes, caret: 0, after: 0 }, from, to);
	// A place before text is read off the character after it: a line's markers end where it stands.
	const placed = (at: number) => {
		const step = /[^\r\n]/.test(bytes[at] ?? '\n') ? 1 : 0;
		return writeLeaf(doc, leaf, { bytes, caret: at + step, after: at }, from, to).caret - step;
	};
	const tailAt = cut.head.length + sep.length;
	const start = placed(tailAt);
	const lineBreak = source.lastIndexOf('\n', start - 1);
	// The first half ends before the line break over the second, at a line's start too: that break
	// is the first half's own line ending, as a split leaves it, never an empty line under it.
	const end = source[lineBreak - 1] === '\r' ? lineBreak - 1 : lineBreak;
	const restAt = below ? end : start;
	return {
		head: source.slice(0, end),
		rest: source.slice(restAt),
		follows: !below && !isBlankText(lineRest(source, start)),
		joined: after !== '',
		caret: after === '' ? 0 : placed(tailAt + cut.at) - restAt,
		tail: cut.tail + ending,
		empty: cut.empty
	};
}

/** Text going in at `start` (up to `end`) in the document's line ending, each later line behind
 *  the markers there and `indent`; a blank one takes them without trailing spaces unless text `follows`. */
export function spliced(
	doc: Doc,
	start: number,
	end: number,
	keep?: (c: LaidBlock) => boolean,
	indent = '',
	follows = !isBlankText(lineRest(doc.source, end))
) {
	const eol = doc.ending;
	const prefix = continuation(doc, start, keep) + indent;
	return (text: string) =>
		displayLines(text)
			.map(({ text: line }, i, lines) => {
				if (i === 0) return line;
				const blank = line === '' && !(i === lines.length - 1 && follows);
				return (blank ? prefix.trimEnd() : prefix) + line;
			})
			.join(eol);
}
