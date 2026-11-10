/**
 * A paste at a caret: the clipboard read with the host, then landed by the rule its first block and
 * the caret's block call for. The caret lands after everything pasted, its last line ending too.
 */

import { displayLines, isBlankText, withLineEnding } from '../core/lines';
import type { LaidBlock } from './layout';
import {
	endingOf,
	factsOf,
	leafAt,
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
	writeLeaf,
	type Edit
} from './leaf-splice';

export function pasteAt(doc: Doc, at: number, clipboard: string, plain: boolean): Edit {
	const lf = clipboard.replace(/\r\n?/g, '\n');
	const edit = landed(doc, at, lf, plain);
	// What lands in an empty paragraph, its line ending alone, stays apart from the block under it.
	const leaf = leafAt(doc, at)?.leaf;
	if (!leaf || !/^\r?\n?$/.test(nodeAt(doc, leaf.path).raw)) return edit;
	if (titleOwner(doc, leaf) || factsOf(doc, leaf).joins !== 'text') return edit;
	const lower = doc.layout.block([...leaf.path.slice(0, -1), leaf.path.at(-1)! + 1]);
	const flush = lower && lower.from <= pastMarkers(doc.source, leaf.to);
	const raw = flush ? lastPasted(doc, leaf, lf, plain) : null;
	if (!lower || raw === null) return edit;
	const below = leaf.to + edit.source.length - doc.source.length;
	const join = { from: at, to: at, upper: leaf, lower, rewritten: { upper: { block: leaf, raw } } };
	return { source: apartAt(doc, edit.source, below, join, true), caret: edit.caret };
}

/** The last block a paste into the empty paragraph `leaf` writes, as its own bytes. */
function lastPasted(doc: Doc, leaf: LaidBlock, clip: string, plain: boolean): string | null {
	const ended = (raw: string) => withLineEnding(raw.replace(/\n?$/, '\n'), endingOf(doc.source));
	if (plain) return ended(doc.host.leaf.plain(doc.tree, leaf.path, clip));
	const blocks = readDoc(clip, doc.host, doc.mode).tree.children;
	const last = blocks.filter((b) => !isBlankText(b.raw)).at(-1);
	// A container the caret's container takes in leaves no block of its own there.
	return last && !last.children?.length ? ended(last.raw) : null;
}

/** The paste of `lf`, clipboard text with LF line endings, at `at`. */
function landed(doc: Doc, at: number, lf: string, plain: boolean): Edit {
	const visibleAfter = lineRest(doc.source, at) !== '';
	// Plain text goes in as lines of the block at the caret: with nothing after the caret, its last
	// line ending would only add an empty line to that block.
	const clip = plain && !visibleAfter ? lf.replace(/\n$/, '') : lf;
	const target = leafAt(doc, at);
	if (!target) {
		const near = pointedBlock(doc, at);
		if (plain && near?.text && factsOf(doc, near).body === 'markdown')
			return insertBytes(doc, at, doc.host.leaf.plain(doc.tree, near.path, clip));
		const marked = !plain && !isBlankText(lineHead(doc.source, at));
		const rest = marked ? emptiedRest(doc, at, readDoc(clip, doc.host, doc.mode)) : null;
		return insertBytes(doc, at, rest ?? clip);
	}
	const { leaf, offset } = target;
	const literal = factsOf(doc, leaf).body === 'literal';
	const titled = titleOwner(doc, leaf);
	if (titled) return intoTitle(doc, titled, leaf, at, clip, plain);
	// Plain text never converts: as written where the text is literal, escaped where it reads.
	if (plain && literal) return insertBytes(doc, at, clip, false);
	if (plain) return insertText(doc, leaf, offset, doc.host.leaf.plain(doc.tree, leaf.path, clip));
	// Literal text takes the paste as written; a line that could close its fence goes through the
	// block's write rule, which grows the fence past it.
	if (literal) {
		const fence = doc.host.fence(nodeAt(doc, leaf.path).raw);
		return fence && displayLines(clip).some((line) => fence.mayClose(line.text))
			? insertText(doc, leaf, offset, clip)
			: insertBytes(doc, at, clip);
	}
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
	if (!first) return insertBytes(doc, at, clip);
	const joins = isText(first) || afterText(doc, leaf, offset, clip);
	const left = joins ? null : leftBy(doc, at, pasted, first, leaf);
	if (left) return splitOut(doc, left, leaf, at, clip, nodeAt(pasted, last!.path).raw);
	// A pasted container the caret's container takes in joins it from its first text, a line
	// break before it included, where its last block can take the text after the caret or none follows.
	const taker = joins ? null : takerOf(doc, at, pasted, first);
	if (taker && (lastJoins || !visibleAfter)) {
		const keep = (c: LaidBlock) => c !== taker;
		const edit = insertText(doc, leaf, offset, withoutOpening(pasted, first), keep);
		return closedBy(doc, pasted, first, taker, edit);
	}
	// A clipboard opening with a line break or a paragraph joins the text before the caret; text
	// after it that the last block can't take goes on a line of its own.
	if (joins || clip.startsWith('\n')) {
		const apart = !lastJoins && visibleAfter && !clip.endsWith('\n');
		const edit = insertText(doc, leaf, offset, apart ? text + '\n' : text);
		if (!apart) return edit;
		const caret = edit.source.lastIndexOf('\n', edit.caret - 1);
		return { source: edit.source, caret: edit.source[caret - 1] === '\r' ? caret - 1 : caret };
	}
	return splitAt(doc, leaf, at, text, isText(first) || isText(last!), lastJoins);
}

/** One line pasted after text on the caret's line reads as that line reads. */
function afterText(doc: Doc, leaf: LaidBlock, offset: number, clip: string): boolean {
	if (clip.includes('\n')) return false;
	const lineStart = lineTextStart(doc, leaf, offset);
	return !isBlankText(doc.source.slice(lineStart, byteAt(doc, leaf, offset)));
}

function insertText(
	doc: Doc,
	leaf: LaidBlock,
	offset: number,
	text: string,
	keep?: (c: LaidBlock) => boolean
): Edit {
	const write = doc.host.leaf.insert(doc.tree, leaf.path, offset, text, doc.mode);
	return writeLeaf(doc, leaf, write, offset, offset, keep);
}

/** Bytes going in at `at` as written, each later line behind the markers there unless `prefixed`
 *  is off. */
function insertBytes(doc: Doc, at: number, text: string, prefixed = true): Edit {
	const lines = prefixed ? spliced(doc, at, at)(text) : withLineEnding(text, endingOf(doc.source));
	return {
		source: doc.source.slice(0, at) + lines + doc.source.slice(at),
		caret: at + lines.length
	};
}

/** A title row holds one line: the paste goes in with each run of line breaks turned to a space,
 *  after a space of its own where the caret stands at the end of the row's name. */
function intoTitle(
	doc: Doc,
	owner: LaidBlock,
	row: LaidBlock,
	at: number,
	text: string,
	plain: boolean
): Edit {
	const flat = text.replace(/\n+$/, '').replace(/\n+/g, ' ');
	const title = plain ? doc.host.leaf.plain(doc.tree, row.path, flat) : flat;
	const atName =
		factsOf(doc, owner).titleRow!.nameNeverEntered &&
		at === row.text!.from &&
		/\S/.test(doc.source[at - 1] ?? ' ');
	const line = (atName && title !== '' ? ' ' : '') + title;
	return { source: doc.source.slice(0, at) + line + doc.source.slice(at), caret: at + line.length };
}
