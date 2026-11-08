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
import { closedBy, emptiedRest, takerOf, withoutOpening } from './container-merge';
import { splitAt } from './paste-split';
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
	const visibleAfter = lineRest(doc.source, at) !== '';
	const lf = clipboard.replace(/\r\n?/g, '\n');
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
	// Plain text never converts: as written where the text is literal, escaped where it reads.
	if (plain && literal) return insertBytes(doc, at, clip, false);
	if (plain) return insertText(doc, leaf, offset, doc.host.leaf.plain(doc.tree, leaf.path, clip));
	if (titleOwner(doc, leaf)) return intoTitle(doc, at, clip);
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
	const tops = pasted.layout.blocks.filter(
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
	// A pasted container the caret's container takes in joins it from its first text, a line
	// break before it included.
	const taker = joins ? null : takerOf(doc, at, pasted, first);
	if (taker && lastJoins) {
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
	const lineStart = Math.max(lineTextStart(doc, leaf, offset), leaf.text!.from);
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

/** A title row holds one line: the paste goes in with each line break turned to a space. */
function intoTitle(doc: Doc, at: number, text: string): Edit {
	const flat = text.replace(/\n+$/, '').replace(/\n/g, ' ');
	return { source: doc.source.slice(0, at) + flat + doc.source.slice(at), caret: at + flat.length };
}
