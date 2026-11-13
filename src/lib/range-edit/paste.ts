/**
 * A paste at a caret, or over a range inside one text block's text: the clipboard read with the
 * host, then landed by the rule its first block and the caret's block call for. A range goes as one
 * write of its block, which keeps its kind, its markers and its other lines; a block boundary the
 * paste puts in the block's text cuts it as a split does (`cutLeaf`). The caret lands after
 * everything pasted, its last line ending too.
 */

import { displayLines, isBlankText, trimTrailingLineEnding, withLineEnding } from '../core/lines';
import { metadataIfKind } from '../core/nodes';
import type { PasteHost } from './host';
import type { LaidBlock } from './layout';
import {
	contentEnd,
	factsOf,
	findWithin,
	isCell,
	joinsName,
	leafHolding,
	nodeAt,
	parentOf,
	pointedBlock,
	readDoc,
	titleOwner,
	withLeafBytes,
	type Doc,
	type Held
} from './document';
import { apartAt, pastMarkers } from './apart';
import { closedBy, emptiedRest, leftBy, takerOf } from './container-merge';
import {
	enteredAt,
	intoBlankUnder,
	itemHolding,
	joinsList,
	onEmptyLine,
	pasteApart,
	restApart,
	restUnder,
	splitAt,
	splitOut
} from './paste-split';
import { numberedAfterTaking, numberedOn } from './list-numbers';
import {
	byteAt,
	cutLeaf,
	lineEndBefore,
	lineHead,
	lineRest,
	lineTextStart,
	spliced,
	writeText,
	writtenText,
	type Cut,
	type Edit
} from './leaf-splice';

/** What a paste brings: the clipboard's text, whether it goes in as plain text, what the caret
 *  holds, and the host's paste transforms, null for a gesture that runs none. */
export interface Pasted {
	text: string;
	plain: boolean;
	held: Held;
	transform: PasteHost['transformPaste'] | null;
	/** Set where the clipboard's last line ending was taken off to land as Enter: it was more than
	 *  one line, so it never reads as one line after text. */
	ended?: true;
}

/** The paste of `pasted` over `[from, to)`: a caret, or a range inside one text block's text. */
export function pasteAt(doc: Doc, from: number, to: number, pasted: Pasted): Edit {
	const seen: { blocks?: Doc } = {};
	const once = { ...pasted, transform: ranOnce(pasted.transform) };
	const edit = itemEntered(doc, from, to, once, seen) ?? landedAt(doc, from, to, once, seen);
	// One write of a block's text is text, whatever the clipboard read as.
	if (!seen.blocks || edit.leaf) return edit;
	const tops = seen.blocks.tree.children.filter((b) => !isBlankText(b.raw));
	return { ...edit, blocks: tops.length };
}

/** `transform` called at most once for a text, since a paste may land its clipboard twice. */
function ranOnce(transform: Pasted['transform']): Pasted['transform'] {
	if (!transform) return null;
	const done = new Map<string, string>();
	return (text, blocks) => {
		if (!done.has(text)) done.set(text, transform(text, blocks));
		return done.get(text)!;
	};
}

/** A last line ending pasted in a list item's text is Enter where it lands: the rest pasted, then
 *  the next item opened at the caret. Null for a caret in any other block, whatever is pasted. */
function itemEntered(
	doc: Doc,
	from: number,
	to: number,
	pasted: Pasted,
	seen: { blocks?: Doc }
): Edit | null {
	const ending = pasted.plain ? null : /\r?\n$/.exec(pasted.text);
	if (!ending || pasted.held.holds !== 'text' || !itemHolding(doc, from, to)) return null;
	// The transforms see the whole clipboard, as they would where the ending lands anywhere else.
	const { transform } = pasted;
	const whole = (text: string) =>
		transform!(text + '\n', readDoc(text + '\n', doc.host, doc.mode).tree);
	const rest: Pasted = {
		...pasted,
		text: pasted.text.slice(0, ending.index),
		ended: true,
		transform: transform && ((text) => whole(text).replace(/\n$/, ''))
	};
	const bare = landedAt(doc, from, to, rest, seen);
	return enteredAt({ ...readDoc(bare.source, doc.host, doc.mode), ending: doc.ending }, bare.caret);
}

/** `pasteAt`, noting in `seen` the clipboard as blocks where the landing read it so. */
function landedAt(
	doc: Doc,
	from: number,
	to: number,
	pasted: Pasted,
	seen: { blocks?: Doc }
): Edit {
	const { plain, held } = pasted;
	// Every container around the place writes its body by its own rule, pasted lines included.
	const around =
		held.holds === 'text' ? leafHolding(doc, from, to)?.leaf.path.slice(0, -1) : held.parent;
	const text = pasted.text.replace(/\r\n?/g, '\n');
	const lf = around?.length ? doc.host.inBodies(doc.tree, around, text) : text;
	// Nothing pasted at a caret changes nothing: a place between blocks would write its markers.
	if (lf === '' && from === to) return { source: doc.source, caret: from };
	// Where the clipboard lands as blocks it is read once, after the transforms: a landing as text
	// (a title, a cell, literal text, plain text, one line after text) never asks.
	let read: Doc | undefined;
	const blocks = () => (seen.blocks = read ??= transformed(doc, lf, pasted.transform));
	const off = () => (plain ? doc.host.escaped(lf) : blocks().source);
	const apart = held.holds === 'text' ? null : pasteApart(doc, from, off, held.parent, true);
	if (apart) return apart;
	const landing = landed(doc, from, to, lf, plain, blocks, pasted.ended === true);
	// What lands in an empty paragraph, its line ending alone, stays apart from the block under it.
	const leaf = leafHolding(doc, from, to)?.leaf;
	if (!leaf || !/^\r?\n?$/.test(nodeAt(doc, leaf.path).raw)) return landing;
	if (titleOwner(doc, leaf) || factsOf(doc, leaf).joins !== 'text') return landing;
	const lower = doc.layout.block([...leaf.path.slice(0, -1), leaf.path.at(-1)! + 1]);
	const flush = lower && lower.from <= pastMarkers(doc.source, leaf.to);
	const edit =
		read && !plain ? listsJoined(doc, leaf, flush ? lower : undefined, landing, read) : landing;
	const raw = flush ? lastPasted(doc, leaf, read?.source ?? lf, plain) : null;
	if (!lower || raw === null) return edit;
	const below = leaf.to + edit.source.length - doc.source.length;
	const join = { from, to, upper: leaf, lower, rewritten: { upper: { block: leaf, raw } } };
	return { source: apartAt(doc, edit.source, below, join, true), caret: edit.caret };
}

/** `edit`, a paste of `pasted` into the empty paragraph `leaf`, with a pasted list joined to a list
 *  of its own type over it and to `lower`, flush under it: the blank line between the two goes. */
function listsJoined(
	doc: Doc,
	leaf: LaidBlock,
	lower: LaidBlock | undefined,
	edit: Edit,
	pasted: Doc
): Edit {
	const tops = pasted.tree.children.filter((b) => !isBlankText(b.raw));
	const lineOf = (at: number) => at - lineHead(doc.source, at).length;
	let { source, caret } = edit;
	if (lower && joinsList(doc, lower, tops.at(-1), false)) {
		const line = lineOf(lower.from) + source.length - doc.source.length;
		const above = source.lastIndexOf('\n', line - 2) + 1;
		if (isBlankText(source.slice(pastMarkers(source, above), line))) {
			source = source.slice(0, above) + source.slice(line);
			// A caret on the line that went stays after the pasted list's last text.
			if (caret >= above) caret = above - (source[above - 2] === '\r' ? 2 : 1);
		}
	}
	const upper = doc.layout.block([...leaf.path.slice(0, -1), leaf.path.at(-1)! - 1]);
	// A paste that joined no list is the landing as it stood, the block it names with it.
	if (!upper || !joinsList(doc, upper, tops[0], true))
		return source === edit.source ? edit : { source, caret };
	const gap = lineOf(leaf.from) - upper.to;
	return { source: source.slice(0, upper.to) + source.slice(upper.to + gap), caret: caret - gap };
}

/** The last block a paste into the empty paragraph `leaf` writes, as its own bytes. */
function lastPasted(doc: Doc, leaf: LaidBlock, clip: string, plain: boolean): string | null {
	const ended = (raw: string) => withLineEnding(raw.replace(/\n?$/, '\n'), doc.ending);
	if (plain) return ended(plainText(doc, leaf, clip));
	const blocks = readDoc(clip, doc.host, doc.mode).tree.children;
	const last = blocks.filter((b) => !isBlankText(b.raw)).at(-1);
	// A container the caret's container takes in leaves no block of its own there.
	return last && !last.children?.length ? ended(last.raw) : null;
}

/** Plain text as `block` takes it: as written where its text is literal, escaped where it reads
 *  Markdown. */
const plainText = (doc: Doc, block: LaidBlock, text: string) =>
	factsOf(doc, block).body === 'literal' ? text : doc.host.escaped(text);

/** Plain text as it goes into the bytes at `at`, a place in no block's text: as the block beside
 *  it takes it. */
function offText(doc: Doc, at: number, clip: string): string {
	const near = pointedBlock(doc, at);
	return near?.text ? plainText(doc, near, clip) : clip;
}

/** `clip` read as blocks, after the host's paste transforms where the gesture runs them. */
function transformed(doc: Doc, clip: string, transform: Pasted['transform']): Doc {
	const raw = readDoc(clip, doc.host, doc.mode);
	const text = transform ? transform(clip, raw.tree) : clip;
	return text === clip ? raw : readDoc(text, doc.host, doc.mode);
}

/** The paste of `lf`, clipboard text with LF line endings, over `[from, to)`; `blocks` reads it as
 *  the blocks it lands as. */
function landed(
	doc: Doc,
	from: number,
	to: number,
	lf: string,
	plain: boolean,
	blocks: () => Doc,
	endingOff: boolean
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
		// Plain text that lands as blocks lands as paragraphs, escaped as a paragraph's text is.
		const text = () => (plain ? doc.host.escaped(clip) : blocks().source);
		// Where a block starts on its syntax, the clipboard lands as blocks above it, never in it.
		const onSyntax = (b: LaidBlock) => b.from === from && b.text?.from !== from;
		const starts = visibleAfter && findWithin(doc, from, from, onSyntax);
		const above = starts ? pasteApart(doc, from, text, starts.path.slice(0, -1), false) : null;
		if (above) return above;
		// On an empty line no block holds, what lands stays apart from the block under it too.
		const lineStart = from - lineHead(doc.source, from).length;
		const emptyLine = !visibleAfter && pastMarkers(doc.source, lineStart) === from;
		if (emptyLine) return onEmptyLine(doc, from, text());
		return bytes(plain ? offText(doc, from, clip) : clip);
	}
	const { leaf } = target;
	const write = (text: string) => writeText(doc, leaf, target.from, target.to, text);
	const titled = titleOwner(doc, leaf);
	if (titled) return intoTitle(doc, titled, leaf, from, to, clip, plain);
	const escaped = () => plainText(doc, leaf, clip);
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
		const indent = fence ? '' : /^[ \t]*/.exec(raw.slice(lineStart, target.from))![0];
		// The same bytes as the block's own: its text with the lines in, no container's markers.
		const lines = displayLines(clip).map((line, i) => (i === 0 ? '' : indent) + line.text);
		const own = raw.slice(0, target.from) + lines.join(doc.ending) + raw.slice(target.to);
		const caret = own.length - (raw.length - target.to);
		return { ...bytes(clip, indent), leaf: { path: leaf.path, raw: own, caret } };
	}
	// Every landing below that sets a block boundary in the block's text asks for the cut once.
	const cutWith = (before: string, after: string, lead = '') =>
		cutLeaf(doc, leaf, target.from, target.to, { before, after, lead });
	// `written`, the block's write of a text, with that text's last line ending after it.
	const brokenAfter = (written: Edit, text: string): Edit => {
		const own = written.leaf;
		if (!own) return write(text);
		const moved = withLeafBytes(doc.tree, leaf.path, own.raw);
		const line = doc.host.leaf.broken(moved, leaf.path, own.caret, doc.mode);
		return writtenText(doc, leaf, line, target.from, target.to);
	};
	const around = (cut: Cut, mid: string, keep?: (c: LaidBlock) => boolean): Edit => {
		const body = spliced(doc, from, to, keep, '', cut.follows)(mid);
		return { source: cut.head + body + cut.rest, caret: cut.head.length + body.length + cut.caret };
	};
	// The block's text after the range on its line, and whether structure stands past it there (a
	// heading's closing run): such a block holds one line.
	const textTo = leaf.text!.to;
	const onLine = doc.source.slice(
		to,
		Math.max(to, Math.min(lineEndBefore(doc.source, to), textTo))
	);
	const follows = onLine !== '';
	const past = doc.source.slice(textTo, contentEnd(doc, leaf));
	const oneLined = /^[^\r\n]*\S/.test(past);
	// Text joins the block's text either side. A blank line in it is a block boundary, and so is a
	// line break the block can't hold or one that ends its text.
	const asText = (text: string): Edit => {
		const gaps = [...text.matchAll(/\n(?:[ \t]*\n)+/g)];
		if (gaps.length > 0) {
			// Blank lines either end of the text join nothing.
			const open = isBlankText(text.slice(0, gaps[0].index)) ? 0 : gaps[0].index;
			const last = gaps.at(-1)!.index + gaps.at(-1)![0].length;
			const close = isBlankText(text.slice(last)) ? text.length : last;
			return around(cutWith(text.slice(0, open), text.slice(close)), text.slice(open, close));
		}
		const line = text.indexOf('\n');
		if (line >= 0 && oneLined)
			return around(cutWith(text.slice(0, line), text.slice(line + 1)), '\n');
		// A last line ending cuts the block as a split there does where structure stands past its text.
		const ending = text.endsWith('\n');
		if (ending && !follows && /\S/.test(past)) return around(cutWith(text.slice(0, -1), ''), '\n');
		// Any other goes in after the text as the block wrote it: the caret memory spends on the text
		// alone, and a run the text ends in closes before the break (`RangeHost.leaf.broken`).
		if (ending && !isBlankText(text)) return brokenAfter(write(text.slice(0, -1)), text);
		// Line breaks alone at a caret go in as bytes, which no write rule re-reads; spaces alone are
		// text the block writes, where a caret at a hidden edge places them.
		return from === to && isBlankText(text) && text.includes('\n') ? bytes(text) : write(text);
	};
	// Plain text never converts: it goes in escaped where the block reads Markdown.
	if (plain) return asText(escaped());
	// One line after text on the caret's line reads as text, so no transform sees it; any other
	// clipboard lands as the blocks the transforms leave.
	const lineAfter = !endingOff && afterText(doc, leaf, target.from, clip);
	const pasted = lineAfter ? readDoc(clip, doc.host, doc.mode) : blocks();
	clip = pasted.source;
	const isText = (b: LaidBlock) => factsOf(pasted, b).joins === 'text';
	const tops = [...pasted.layout.within(0, clip.length)].filter(
		(b) => b.path.length === 1 && !(isText(b) && isBlankText(clip.slice(b.from, b.to)))
	);
	const first = tops[0];
	const last = tops.at(-1);
	if (lineAfter || !first || (tops.length === 1 && isText(first))) return asText(clip);
	const lastJoins = factsOf(pasted, last!).joins !== 'never';
	const lastRaw = nodeAt(pasted, last!.path).raw;
	const joins = isText(first);
	const left = joins ? null : leftBy(doc, from, pasted, first, leaf);
	if (left) return splitOut(doc, left, leaf, from, to, cutWith('', ''), clip, lastRaw);
	// A paragraph the clipboard ends on joins the text after the cut where the last block takes it;
	// any other last block takes that text behind its own last line, which the cut is read behind.
	const ended = /^\n?$/.test(clip.slice(contentEnd(pasted, last!)));
	const tailOf = (joined: boolean) =>
		joined && isText(last!) && ended ? clip.slice(last!.from) : '';
	const lastLine = lastJoins && !clip.endsWith('\n') ? lastLineOf(pasted, last!) : null;
	const lead = lastLine === null || isText(last!) ? '' : clip.slice(lastLine);
	// A pasted container the caret's container takes in joins it from its first text, a line
	// break before it included, where its last block can take the text after the caret or none follows.
	const taker = joins ? null : takerOf(doc, from, pasted, first);
	if (taker && (lastJoins || !follows)) {
		const keep = (c: LaidBlock) => c !== taker;
		const inner = takenIn(pasted, first);
		const behind = inner.after === '' ? lead : '';
		const edit = around(cutWith(inner.before, inner.after, behind), inner.mid, keep);
		const item = leaf.path[taker.path.length];
		return numberedAfterTaking(doc, taker, item, closedBy(doc, pasted, first, taker, edit));
	}
	// A clipboard opening with a line break or a paragraph joins the text before the caret; text
	// after it that the last block can't take goes on a line of its own, apart where it must be.
	if (joins || clip.startsWith('\n')) {
		const before = clip.startsWith('\n') ? '' : clip.slice(0, contentEnd(pasted, first));
		const after = tailOf(lastJoins && (last !== first || before === ''));
		const cut = cutWith(before, after, lead);
		const visible = lineRest(cut.rest, 0) !== '';
		const apart = !lastJoins && visible && !clip.endsWith('\n');
		const ends = !lastJoins && !visible;
		const text = apart ? clip + '\n' : ends ? intoBlankUnder(doc, to, clip) : clip;
		const edit = around(cut, text.slice(before.length, text.length - after.length));
		if (lastJoins) return restUnder(doc, edit, leaf, to, cut, lastRaw);
		const ending = apart ? edit.source.lastIndexOf('\n', edit.caret - 1) : edit.caret;
		const caret = apart && edit.source[ending - 1] === '\r' ? ending - 1 : ending;
		return restApart(doc, { source: edit.source, caret }, leaf, to, cut, lastRaw);
	}
	// Under text the last block joins what follows; with none before the cut only a paragraph's
	// text joins it, and only where the clipboard ends on no line ending.
	const under = doc.source.slice(leaf.text!.from, from) !== '';
	const flush = !isBlankText(onLine) && factsOf(doc, leaf).joins === 'text' && !clip.endsWith('\n');
	const after = tailOf(lastJoins && (under || flush));
	const cut = cutWith('', after, lead);
	// A heading or a to-do left with no text gives way: the blocks land on its line as on an empty
	// one, and a list it stood in numbers on.
	const gone = cut.empty
		? givesWay(doc, leaf, cut, clip.slice(first.from, contentEnd(pasted, first)))
		: null;
	if (gone) {
		const end = contentEnd(doc, gone);
		const bare = doc.source.slice(0, gone.from) + doc.source.slice(end);
		const emptied = { ...readDoc(bare, doc.host, doc.mode), ending: doc.ending };
		const landing: Pasted = { text: clip, plain: false, held: { holds: 'text' }, transform: null };
		// Bytes alone: a block the landing names is one of the document without the one that went.
		const { source, caret } = pasteAt(emptied, gone.from, gone.from, landing);
		return { source: numberedOn(doc, gone.from, end, source), caret };
	}
	const ends = !lastJoins && lineRest(cut.rest, 0) === '';
	const text = ends ? intoBlankUnder(doc, to, clip) : clip;
	const mid = text.slice(0, text.length - after.length);
	return splitAt(doc, leaf, from, to, cut, mid, lastJoins, lastRaw);
}

/** What gives way to blocks pasted over all of `leaf`'s text, the first of them `first`: a heading,
 *  or the to-do `leaf` is all of where `first` has lines. A plain item holds them after its marker. */
function givesWay(doc: Doc, leaf: LaidBlock, cut: Cut, first: string): LaidBlock | null {
	if (cut.head.length > leaf.from) return leaf;
	// A to-do's box marks one line of text, as typing after it does; a block of lines is no text.
	if (!first.includes('\n')) return null;
	const item = parentOf(doc, leaf);
	const list = item && parentOf(doc, item);
	if (!list || factsOf(doc, list).lines !== 'items') return null;
	const node = nodeAt(doc, item.path);
	return metadataIfKind(node, 'listItem')?.taskItem && node.children?.length === 1 ? item : null;
}

/** Where the last line of the text `block` ends on starts, in a pasted block that is no paragraph;
 *  null where it ends on no Markdown text (a closing line, a code block). */
function lastLineOf(pasted: Doc, block: LaidBlock): number | null {
	const leaf = [...pasted.layout.within(block.from, block.to)].filter((b) => b.text).at(-1);
	if (!leaf || contentEnd(pasted, leaf) !== contentEnd(pasted, block)) return null;
	if (factsOf(pasted, leaf).body !== 'markdown') return null;
	return Math.max(lastLineStart(pasted, leaf), leaf.text!.from);
}

/** Where the last line of the text block `leaf` starts. */
function lastLineStart(pasted: Doc, leaf: LaidBlock): number {
	const raw = trimTrailingLineEnding(nodeAt(pasted, leaf.path).raw);
	return pasted.layout.byteOf(leaf.path, raw.lastIndexOf('\n') + 1)!;
}

/** A pasted container's content as its taker holds it: its first paragraph's first line, the last
 *  line of a paragraph that ends the clipboard (its own, or one under it), and the bytes between. */
function takenIn(pasted: Doc, first: LaidBlock): { before: string; mid: string; after: string } {
	const { source } = pasted;
	const texts = [...pasted.layout.within(first.from, source.length)].filter(
		(b) => b.text && b.from >= first.from && !titleOwner(pasted, b)
	);
	const paragraph = (b: LaidBlock) => factsOf(pasted, b).joins === 'text';
	const [head, tail] = [texts[0], texts.at(-1)];
	const start = head?.text?.from ?? first.from;
	const joined = head && paragraph(head) ? lineEndBefore(source, start) : start;
	const closes =
		tail !== undefined &&
		paragraph(tail) &&
		(tail.path.slice(0, -1).join() === first.path.join() ||
			(tail.path.length === first.path.length && !isBlankText(nodeAt(pasted, tail.path).raw))) &&
		contentEnd(pasted, tail) === source.length &&
		lastLineStart(pasted, tail) > joined;
	const end = closes ? lastLineStart(pasted, tail) : source.length;
	return {
		before: source.slice(start, joined),
		mid: source.slice(joined, end),
		after: source.slice(end)
	};
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
	const title = plain ? plainText(doc, row, flat) : flat;
	const line = (joinsName(doc, owner, row, from) && title !== '' ? ' ' : '') + title;
	return {
		source: doc.source.slice(0, from) + line + doc.source.slice(to),
		caret: from + line.length
	};
}
