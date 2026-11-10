/**
 * A paste at a caret, or over a range inside one text block's text: the clipboard read with the
 * host, then landed by the rule its first block and the caret's block call for. A range goes as one
 * write of its block, which keeps its kind, its markers and its other lines. The caret lands after
 * everything pasted, its last line ending too.
 */

import { displayLines, isBlankText, withLineEnding } from '../core/lines';
import type { LaidBlock } from './layout';
import {
	factsOf,
	isCell,
	leafHolding,
	nodeAt,
	pointedBlock,
	readDoc,
	titleOwner,
	type Doc
} from './document';
import { apartAt, pastMarkers } from './apart';
import { closedBy, emptiedRest, leftBy, takerOf, withoutOpening } from './container-merge';
import { splitAt, splitOut } from './paste-split';
import {
	byteAt,
	lineHead,
	lineRest,
	lineTextStart,
	spliced,
	writeText,
	type Edit
} from './leaf-splice';

/** The paste of `clipboard` over `[from, to)`: a caret, or a range inside one text block's text. */
export function pasteAt(
	doc: Doc,
	from: number,
	to: number,
	clipboard: string,
	plain: boolean
): Edit {
	const lf = clipboard.replace(/\r\n?/g, '\n');
	const edit = landed(doc, from, to, lf, plain);
	// What lands in an empty paragraph, its line ending alone, stays apart from the block under it.
	const leaf = leafHolding(doc, from, to)?.leaf;
	if (!leaf || !/^\r?\n?$/.test(nodeAt(doc, leaf.path).raw)) return edit;
	if (titleOwner(doc, leaf) || factsOf(doc, leaf).joins !== 'text') return edit;
	const lower = doc.layout.block([...leaf.path.slice(0, -1), leaf.path.at(-1)! + 1]);
	const flush = lower && lower.from <= pastMarkers(doc.source, leaf.to);
	const raw = flush ? lastPasted(doc, leaf, lf, plain) : null;
	if (!lower || raw === null) return edit;
	const below = leaf.to + edit.source.length - doc.source.length;
	const join = { from, to, upper: leaf, lower, rewritten: { upper: { block: leaf, raw } } };
	return { source: apartAt(doc, edit.source, below, join, true), caret: edit.caret };
}

/** The last block a paste into the empty paragraph `leaf` writes, as its own bytes. */
function lastPasted(doc: Doc, leaf: LaidBlock, clip: string, plain: boolean): string | null {
	const ended = (raw: string) => withLineEnding(raw.replace(/\n?$/, '\n'), doc.ending);
	if (plain) return ended(doc.host.leaf.plain(doc.tree, leaf.path, clip));
	const blocks = readDoc(clip, doc.host, doc.mode).tree.children;
	const last = blocks.filter((b) => !isBlankText(b.raw)).at(-1);
	// A container the caret's container takes in leaves no block of its own there.
	return last && !last.children?.length ? ended(last.raw) : null;
}

/** The paste of `lf`, clipboard text with LF line endings, over `[from, to)`. */
function landed(doc: Doc, from: number, to: number, lf: string, plain: boolean): Edit {
	const visibleAfter = lineRest(doc.source, to) !== '';
	// Plain text goes in as lines of the block at the caret: with nothing after the caret, its last
	// line ending would only add an empty line to that block.
	const clip = plain && !visibleAfter ? lf.replace(/\n$/, '') : lf;
	const target = leafHolding(doc, from, to);
	const bytes = (text: string, indent?: string) => insertBytes(doc, from, to, text, indent);
	if (!target) {
		const near = pointedBlock(doc, from);
		if (plain && near?.text && factsOf(doc, near).body === 'markdown')
			return bytes(doc.host.leaf.plain(doc.tree, near.path, clip));
		const marked = !plain && !isBlankText(lineHead(doc.source, from));
		const rest = marked ? emptiedRest(doc, from, readDoc(clip, doc.host, doc.mode)) : null;
		return bytes(rest ?? clip);
	}
	const { leaf } = target;
	const write = (text: string, keep?: (c: LaidBlock) => boolean) =>
		writeText(doc, leaf, target.from, target.to, text, keep);
	const titled = titleOwner(doc, leaf);
	if (titled) return intoTitle(doc, titled, leaf, from, to, clip, plain);
	const escaped = () => doc.host.leaf.plain(doc.tree, leaf.path, clip);
	// A cell holds one line, so its own write takes the text whatever it would read as alone.
	if (isCell(doc, leaf)) return write(oneLine(plain ? escaped() : clip));
	// Literal text takes the paste as written, plain or not; a line that could close its fence goes
	// through the block's write rule, which grows the fence past it.
	if (factsOf(doc, leaf).body === 'literal') {
		const raw = nodeAt(doc, leaf.path).raw;
		const fence = doc.host.fence(raw);
		if (fence && displayLines(clip).some((line) => fence.mayClose(line.text))) return write(clip);
		// With no fence, a line stays in the block by its indent, which a new line repeats.
		const lineStart = raw.lastIndexOf('\n', target.from - 1) + 1;
		return bytes(clip, fence ? '' : /^[ \t]*/.exec(raw.slice(lineStart, target.from))![0]);
	}
	// Plain text never converts: it goes in escaped where the block reads Markdown.
	if (plain) return write(escaped());
	const pasted = readDoc(clip, doc.host, doc.mode);
	const isText = (b: LaidBlock) => factsOf(pasted, b).joins === 'text';
	const tops = [...pasted.layout.within(0, clip.length)].filter(
		(b) => b.path.length === 1 && !(isText(b) && isBlankText(clip.slice(b.from, b.to)))
	);
	const first = tops[0];
	const last = tops.at(-1);
	const lastJoins = !last || factsOf(pasted, last).joins !== 'never';
	// Where nothing follows the caret, a last block that takes no text (code, a table) ends on the
	// caret line's own ending, which stands for the clipboard's last one.
	const ownEnding = !lastJoins && !visibleAfter && clip.endsWith('\n');
	const text = ownEnding ? clip.slice(0, -1) : clip;
	// Line breaks alone go in as bytes: the block's own write could re-read them (a setext heading's
	// underline would go).
	if (!first) return bytes(clip);
	const joins = isText(first) || afterText(doc, leaf, target.from, clip);
	const left = joins ? null : leftBy(doc, from, pasted, first, leaf);
	if (left) return splitOut(doc, left, leaf, from, to, clip, nodeAt(pasted, last!.path).raw);
	// A pasted container the caret's container takes in joins it from its first text, a line
	// break before it included, where its last block can take the text after the caret or none follows.
	const taker = joins ? null : takerOf(doc, from, pasted, first);
	if (taker && (lastJoins || !visibleAfter)) {
		const edit = write(withoutOpening(pasted, first), (c) => c !== taker);
		return closedBy(doc, pasted, first, taker, edit);
	}
	// A clipboard opening with a line break or a paragraph joins the text before the caret; text
	// after it that the last block can't take goes on a line of its own.
	if (joins || clip.startsWith('\n')) {
		const apart = !lastJoins && visibleAfter && !clip.endsWith('\n');
		const edit = write(apart ? text + '\n' : text);
		if (!apart) return edit;
		const caret = edit.source.lastIndexOf('\n', edit.caret - 1);
		return { source: edit.source, caret: edit.source[caret - 1] === '\r' ? caret - 1 : caret };
	}
	return splitAt(doc, leaf, from, to, text, lastJoins);
}

/** Text for a block that holds one line: each run of line breaks a space, a last one dropped. */
const oneLine = (text: string) => text.replace(/\n+$/, '').replace(/\n+/g, ' ');

/** One line pasted after text on the caret's line reads as that line reads. */
function afterText(doc: Doc, leaf: LaidBlock, offset: number, clip: string): boolean {
	if (clip.includes('\n')) return false;
	const lineStart = lineTextStart(doc, leaf, offset);
	return !isBlankText(doc.source.slice(lineStart, byteAt(doc, leaf, offset)));
}

/** Bytes going in over `[from, to)` as written, each later line behind the markers there and
 *  `indent`. */
function insertBytes(doc: Doc, from: number, to: number, text: string, indent = ''): Edit {
	const lines = spliced(doc, from, to, undefined, indent)(text);
	return {
		source: doc.source.slice(0, from) + lines + doc.source.slice(to),
		caret: from + lines.length
	};
}

/** A title row holds one line: the paste goes in with each run of line breaks turned to a space,
 *  after a space of its own where the caret stands at the end of the row's name. */
function intoTitle(
	doc: Doc,
	owner: LaidBlock,
	row: LaidBlock,
	from: number,
	to: number,
	text: string,
	plain: boolean
): Edit {
	const flat = oneLine(text);
	const title = plain ? doc.host.leaf.plain(doc.tree, row.path, flat) : flat;
	const atName =
		factsOf(doc, owner).titleRow!.nameNeverEntered &&
		from === row.text!.from &&
		/\S/.test(doc.source[from - 1] ?? ' ');
	const line = (atName && title !== '' ? ' ' : '') + title;
	return {
		source: doc.source.slice(0, from) + line + doc.source.slice(to),
		caret: from + line.length
	};
}
