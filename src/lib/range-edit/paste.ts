/**
 * A paste at a caret, or over a range inside one text block's text: the clipboard read with the
 * host, then landed by the rule its first block and the caret's block call for. A range goes as one
 * write of its block, which keeps its kind, its markers and its other lines. The caret lands after
 * everything pasted, its last line ending too.
 */

import type { SpliceCaret } from '../action-contracts';
import { displayLines, isBlankText, withLineEnding } from '../core/lines';
import type { PasteHost } from './host';
import type { LaidBlock } from './layout';
import {
	factsOf,
	findWithin,
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
import { apartBelow, pasteApart, restApart, splitAt, splitOut } from './paste-split';
import {
	byteAt,
	lineHead,
	lineRest,
	lineTextStart,
	spliced,
	writeText,
	type Edit
} from './leaf-splice';

/** What a paste brings: the clipboard's text, whether it goes in as plain text, what the caret
 *  holds, and the host's paste transforms, null for a gesture that runs none. */
export interface Pasted {
	text: string;
	plain: boolean;
	holds: SpliceCaret['holds'];
	transform: PasteHost['transformPaste'] | null;
}

/** The paste of `pasted` over `[from, to)`: a caret, or a range inside one text block's text. */
export function pasteAt(doc: Doc, from: number, to: number, pasted: Pasted): Edit {
	const { plain, holds } = pasted;
	const lf = pasted.text.replace(/\r\n?/g, '\n');
	// Where the clipboard lands as blocks it is read once, after the transforms: a landing as text
	// (a title, a cell, literal text, plain text, one line after text) never asks.
	let read: Doc | undefined;
	const blocks = () => (read ??= transformed(doc, lf, pasted.transform));
	const off = () => (plain ? offText(doc, from, lf) : blocks().source);
	const apart = holds === 'text' ? null : pasteApart(doc, from, off);
	if (apart) return apart;
	const edit = landed(doc, from, to, lf, plain, blocks);
	// What lands in an empty paragraph, its line ending alone, stays apart from the block under it.
	const leaf = leafHolding(doc, from, to)?.leaf;
	if (!leaf || !/^\r?\n?$/.test(nodeAt(doc, leaf.path).raw)) return edit;
	if (titleOwner(doc, leaf) || factsOf(doc, leaf).joins !== 'text') return edit;
	const lower = doc.layout.block([...leaf.path.slice(0, -1), leaf.path.at(-1)! + 1]);
	const flush = lower && lower.from <= pastMarkers(doc.source, leaf.to);
	const raw = flush ? lastPasted(doc, leaf, read?.source ?? lf, plain) : null;
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

/** Plain text as it goes in at `at`, a place in no block's text: escaped where the block beside
 *  it reads Markdown. */
function offText(doc: Doc, at: number, clip: string): string {
	const near = pointedBlock(doc, at);
	return near?.text && factsOf(doc, near).body === 'markdown'
		? doc.host.leaf.plain(doc.tree, near.path, clip)
		: clip;
}

/** `clip` read as blocks, after the host's paste transforms where the gesture runs them. */
function transformed(doc: Doc, clip: string, transform: Pasted['transform']): Doc {
	const raw = readDoc(clip, doc.host, doc.mode);
	const text = transform ? transform(clip, raw.tree) : clip;
	return text === clip ? raw : readDoc(text, doc.host, doc.mode);
}

/** The paste of `lf`, clipboard text with LF line endings, over `[from, to)`; `blocks` reads it as
 *  the blocks it lands as. `typed`: the range is the letter `typedOver` left. */
function landed(
	doc: Doc,
	from: number,
	to: number,
	lf: string,
	plain: boolean,
	blocks: () => Doc,
	typed = false
): Edit {
	const visibleAfter = lineRest(doc.source, to) !== '';
	// Plain text goes in as lines of the block at the caret: with nothing after the caret, its last
	// line ending would only add an empty line to that block.
	let clip = plain && !visibleAfter ? lf.replace(/\n$/, '') : lf;
	const target = leafHolding(doc, from, to);
	const bytes = (text: string, indent?: string) => insertBytes(doc, from, to, text, indent);
	if (!target) {
		const marked = !plain && !isBlankText(lineHead(doc.source, from));
		const rest = marked ? emptiedRest(doc, from, readDoc(clip, doc.host, doc.mode)) : null;
		if (rest !== null) return bytes(rest);
		const text = () => (plain ? offText(doc, from, clip) : blocks().source);
		// Where a block starts on its syntax, the clipboard lands as blocks above it, never in it.
		const onSyntax = (b: LaidBlock) => b.from === from && b.text?.from !== from;
		const starts = visibleAfter && findWithin(doc, from, from, onSyntax);
		const above = starts ? pasteApart(doc, from, text) : null;
		if (above) return above;
		// On an empty line no block holds, what lands stays apart from the block under it too.
		const lineStart = from - lineHead(doc.source, from).length;
		const emptyLine = !visibleAfter && pastMarkers(doc.source, lineStart) === from;
		if (emptyLine) return apartBelow(doc, bytes(text()), from, text());
		return bytes(plain ? offText(doc, from, clip) : clip);
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
	// A landing that takes the range out by its bytes runs on the bytes the block's own write leaves
	// around it, where those differ: in live mode that write closes a format run the range cuts.
	const byBytes = (land: () => Edit) => {
		const over = from < to && !typed ? typedOver(doc, leaf, target.from, target.to) : null;
		return over ? landed(over.doc, over.from, over.to, lf, plain, blocks, true) : land();
	};
	// One line after text on the caret's line reads as text, so no transform sees it; any other
	// clipboard lands as the blocks the transforms leave.
	const lineAfter = afterText(doc, leaf, target.from, clip);
	const pasted = lineAfter ? readDoc(clip, doc.host, doc.mode) : blocks();
	clip = pasted.source;
	const isText = (b: LaidBlock) => factsOf(pasted, b).joins === 'text';
	const tops = [...pasted.layout.within(0, clip.length)].filter(
		(b) => b.path.length === 1 && !(isText(b) && isBlankText(clip.slice(b.from, b.to)))
	);
	const first = tops[0];
	const last = tops.at(-1);
	const lastJoins = !last || factsOf(pasted, last).joins !== 'never';
	const lastRaw = last ? nodeAt(pasted, last.path).raw : '';
	// Where nothing follows the caret, a last block that takes no text (code, a table) ends on the
	// caret line's own ending, which stands for the clipboard's last one.
	const ownEnding = !lastJoins && !visibleAfter && clip.endsWith('\n');
	const text = ownEnding ? clip.slice(0, -1) : clip;
	// Line breaks alone go in as bytes: the block's own write could re-read them (a setext heading's
	// underline would go).
	if (!first) return byBytes(() => bytes(clip));
	const joins = isText(first) || lineAfter;
	const left = joins ? null : leftBy(doc, from, pasted, first, leaf);
	if (left) return byBytes(() => splitOut(doc, left, leaf, from, to, clip, lastRaw));
	// A pasted container the caret's container takes in joins it from its first text, a line
	// break before it included, where its last block can take the text after the caret or none follows.
	const taker = joins ? null : takerOf(doc, from, pasted, first);
	if (taker && (lastJoins || !visibleAfter)) {
		const edit = write(withoutOpening(pasted, first), (c) => c !== taker);
		return closedBy(doc, pasted, first, taker, edit);
	}
	// A clipboard opening with a line break or a paragraph joins the text before the caret; text
	// after it that the last block can't take goes on a line of its own, apart where it must be.
	if (joins || clip.startsWith('\n')) {
		const apart = !lastJoins && visibleAfter && !clip.endsWith('\n');
		const edit = write(apart ? text + '\n' : text);
		if (lastJoins) return edit;
		const ending = apart ? edit.source.lastIndexOf('\n', edit.caret - 1) : edit.caret;
		const caret = apart && edit.source[ending - 1] === '\r' ? ending - 1 : ending;
		return restApart(doc, { source: edit.source, caret }, leaf, to, lastRaw);
	}
	return byBytes(() => splitAt(doc, leaf, from, to, text, lastJoins, lastRaw));
}

/** `doc` with `[from, to)` of the block's bytes written over by one letter, as typing over the range
 *  leaves the block, and where that letter stands; null where the write changes no other byte. */
function typedOver(doc: Doc, leaf: LaidBlock, from: number, to: number) {
	const [start, end] = [byteAt(doc, leaf, from), byteAt(doc, leaf, to)];
	const edit = writeText(doc, leaf, from, to, 'x');
	const at = edit.caret - 1;
	if (edit.source === doc.source.slice(0, start) + 'x' + doc.source.slice(end)) return null;
	const written = { ...readDoc(edit.source, doc.host, doc.mode), ending: doc.ending };
	const held = edit.source[at] === 'x' && leafHolding(written, at, edit.caret);
	return held ? { doc: written, from: at, to: edit.caret } : null;
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
