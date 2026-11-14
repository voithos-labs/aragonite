/**
 * A paste at a caret, or over a range inside one text block's text: the clipboard read with the
 * host, then landed by the rule its first block and the caret's block call for. A range goes as one
 * write of its block, which keeps its kind, its markers and its other lines; a block boundary the
 * paste puts in the block's text cuts it as a split does (`cutLeaf`). The caret lands after
 * everything pasted, its last line ending too.
 */

import { displayLines, isBlankText, trimTrailingLineEnding, withLineEnding } from '../core/lines';
import { metadataIfKind } from '../core/nodes';
import { sharedPrefixLength, sharedSuffixLength } from '../core/written-span';
import type { PasteHost } from './host';
import type { LaidBlock } from './layout';
import {
	closedByOwnLine,
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
	literalLines,
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
import { numberedAfterTaking } from './list-numbers';
import { continuation } from './markers';
import {
	blankedApart,
	byteAt,
	cutLeaf,
	lineEnd,
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
	/** The block held whole the gesture took first, in the document before it did: a paste that
	 *  leaves its line blank answers as the block's emptying write does. */
	emptied?: { doc: Doc; block: LaidBlock };
}

/** The paste of `pasted` over `[from, to)`: a caret, or a range inside one text block's text. */
export function pasteAt(doc: Doc, from: number, to: number, pasted: Pasted): Edit {
	const seen: { blocks?: Doc } = {};
	const text = asPasted(doc, from, to, pasted.text);
	const once = { ...pasted, text, transform: ranOnce(pasted.transform) };
	const landing = entered(doc, from, to, once, seen) ?? landedAt(doc, from, to, once, seen);
	// Only blank text with no line ending leaves the block's own line blank.
	const { emptied } = pasted;
	const blanked = emptied && /^[ \t]+$/.test(pasted.text);
	const edit = blanked ? blankedApart(emptied.doc, emptied.block, landing) : landing;
	// One write of a block's text is text, whatever the clipboard read as.
	if (!seen.blocks || edit.leaf) return edit;
	const tops = seen.blocks.tree.children.filter((b) => !isBlankText(b.raw));
	return { ...edit, blocks: tops.length };
}

/** The clipboard as the place `[from, to)` takes it: a trailing line of only spaces or tabs is a
 *  blank line, so a line ending, its spaces unwritten; literal text keeps every byte. */
export function asPasted(doc: Doc, from: number, to: number, text: string): string {
	const held = leafHolding(doc, from, to);
	if (held && literalLines(doc, held.leaf)) return text;
	return text.replace(/(?:\r?\n[ \t]*)+$/, (tail) => tail.replace(/[ \t]/g, ''));
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

/** The clipboard's last line endings, each as Enter where the one before left the caret; null where
 *  they land with the clipboard, a blank line among them a split (`landed`). */
function entered(
	doc: Doc,
	from: number,
	to: number,
	pasted: Pasted,
	seen: { blocks?: Doc }
): Edit | null {
	const endings = pasted.plain ? null : /(?:\r?\n)+$/.exec(pasted.text);
	if (!endings || pasted.held.holds !== 'text') return null;
	const text = pasted.text.slice(0, endings.index);
	const count = endings[0].match(/\n/g)!.length;
	const held = leafHolding(doc, from, to);
	// Literal text takes the ending as a line of its own text.
	if (held && literalLines(doc, held.leaf)) return null;
	if (held && isBlankText(text) && headingEmptied(doc, held)) return headingGone(doc, held, count);
	// The transforms see the whole clipboard, as they would where the ending lands anywhere else.
	const { transform } = pasted;
	const lines = '\n'.repeat(count);
	const keeping = (kept: number): Pasted => {
		const tail = '\n'.repeat(kept);
		const whole = (clip: string) => {
			const all = clip.slice(0, clip.length - kept) + lines;
			const out = transform!(all, readDoc(all, doc.host, doc.mode).tree);
			return out.replace(new RegExp(`\\n{0,${count}}$`), '') + tail;
		};
		return { ...pasted, text: text + tail, transform: transform && whole };
	};
	const host = itemHolding(doc, from, to);
	const bare: Pasted = { ...keeping(0), ended: true };
	// In an item, endings alone are Enter from the first. Elsewhere only a pasted list ends in a list
	// of the document; a container the caret's took in ends inside it, where the ending is text's.
	const first =
		host && text === ''
			? enteredAgain(doc, landedAt(doc, from, to, bare, seen))
			: host || endsOnList(doc, text)
				? enteredInList(doc, from, to, bare, host, seen)
				: endsTakenIn(doc, from, text)
					? enteredInText(doc, from, to, bare, seen)
					: null;
	if (!first && count === 1) return null;
	let edit = first ?? landedAt(doc, from, to, keeping(1), seen);
	// Past an empty line the first ending opened, each later one goes as Enter does there.
	if (!first && !onBlankLine(edit)) return null;
	let enter = first !== null;
	for (let i = 1; i < count; i++) {
		const next = enteredAgain(doc, edit);
		enter ||= next !== edit;
		edit = next;
	}
	return enter ? { ...edit, entered: true } : edit;
}

/** Whether `held` is the whole text of a block that keeps its type around joined text (a heading):
 *  a paste of no text there leaves it textless, and its syntax gives way as a blur would write it. */
function headingEmptied(doc: Doc, { leaf, from, to }: NonNullable<ReturnType<typeof leafHolding>>) {
	const { text } = leaf;
	const own = !isCell(doc, leaf) && !titleOwner(doc, leaf);
	const whole =
		!!text && byteAt(doc, leaf, from) === text.from && byteAt(doc, leaf, to) === text.to;
	return own && whole && factsOf(doc, leaf).joins === 'text-keeping-type';
}

/** Line endings alone over an emptied heading: Enter there takes the heading away, leaving its line
 *  empty, and each ending is Enter on the line the one before left (an empty line stacks nothing). */
function headingGone(
	doc: Doc,
	{ leaf }: NonNullable<ReturnType<typeof leafHolding>>,
	count: number
): Edit {
	// The line left blank keeps its markers without their trailing spaces, as Enter leaves one.
	const marks = lineHead(doc.source, leaf.from).trimEnd();
	const lineStart = leaf.from - lineHead(doc.source, leaf.from).length;
	const source = doc.source.slice(0, lineStart) + marks + doc.source.slice(contentEnd(doc, leaf));
	const gone: Edit = { source, caret: lineStart + marks.length };
	let edit = gone;
	for (let i = 0; i < count; i++) edit = enteredAgain(doc, edit);
	// The emptied line keeps the caret as text; a line Enter opened past it is Enter's.
	return edit === gone ? edit : { ...edit, entered: true };
}

/** The first of the clipboard's last line endings as Enter where what was pasted ends in a list
 *  holding the caret's item or an item of the document's; null where it opens no item. */
function enteredInList(
	doc: Doc,
	from: number,
	to: number,
	rest: Pasted,
	host: ReturnType<typeof itemHolding>,
	seen: { blocks?: Doc }
): Edit | null {
	const bare = landedAt(doc, from, to, rest, seen);
	const path = host?.item.path;
	const kind = path && {
		node: nodeAt(doc, path),
		marker: doc.host.itemAfter(doc.tree, path),
		depth: path.length
	};
	const after = { ...readDoc(bare.source, doc.host, doc.mode), ending: doc.ending };
	// A byte the paste left as it was, before or after what it changed, is the document's own.
	const shorter = Math.min(doc.source.length, bare.source.length);
	const head = sharedPrefixLength(doc.source, bare.source, shorter);
	const tail = sharedSuffixLength(doc.source, bare.source, shorter - head);
	const own = (byte: number) => byte < head || byte >= bare.source.length - tail;
	return enteredAt(after, bare.caret, kind, own);
}

/** The first of the clipboard's last line endings as a line ending pasted where the paste without it
 *  left the caret, inside the container that took it in. */
function enteredInText(
	doc: Doc,
	from: number,
	to: number,
	rest: Pasted,
	seen: { blocks?: Doc }
): Edit {
	const bare = landedAt(doc, from, to, rest, seen);
	const after = { ...readDoc(bare.source, doc.host, doc.mode), ending: doc.ending };
	const line: Pasted = { text: '\n', plain: false, held: { holds: 'text' }, transform: null };
	const { source, caret } = pasteAt(after, bare.caret, bare.caret, line);
	return { source, caret };
}

/** Whether `text` is one container a container at `at` takes in, ending inside it: a blank line
 *  after it is a line that leaves it. */
function endsTakenIn(doc: Doc, at: number, text: string): boolean {
	const read = readDoc(text, doc.host, doc.mode);
	const tops = read.tree.children.flatMap((b, i) => (isBlankText(b.raw) ? [] : [i]));
	const first = tops.length === 1 ? read.layout.block([tops[0]]) : undefined;
	if (!first?.container || text.slice(contentEnd(read, first)).includes('\n')) return false;
	return takerOf(doc, at, read, first) !== null;
}

/** `edit` with Enter where it left the caret, a block out of its container as Enter's own code takes
 *  it (`RangeHost.enterOut`); on an empty line Enter would only stack another on, nothing (§ 5.6). */
function enteredAgain(doc: Doc, edit: Edit): Edit {
	const now = { ...readDoc(edit.source, doc.host, doc.mode), ending: doc.ending };
	const item = itemHolding(now, edit.caret, edit.caret)?.item;
	const leaf = leafHolding(now, edit.caret, edit.caret)?.leaf;
	const out = (item ?? leaf) && doc.host.enterOut(now.tree, (item ?? leaf)!.path);
	if (out) return out;
	const next = item && enteredAt(now, edit.caret, undefined, () => true);
	if (next) return next;
	if (onBlankLine(edit)) return edit;
	const line: Pasted = { text: '\n', plain: false, held: { holds: 'text' }, transform: null };
	const { source, caret } = pasteAt(now, edit.caret, edit.caret, line);
	return { source, caret };
}

/** Whether `edit` left the caret on a line with nothing past its markers. */
function onBlankLine({ source, caret }: Edit): boolean {
	const lineStart = caret - lineHead(source, caret).length;
	return isBlankText(lineRest(source, pastMarkers(source, lineStart)));
}

/** Whether the clipboard's last block is a list. */
function endsOnList(doc: Doc, text: string): boolean {
	const read = readDoc(text, doc.host, doc.mode);
	const index = read.tree.children.findLastIndex((b) => !isBlankText(b.raw));
	const last = index < 0 ? undefined : read.layout.block([index]);
	return !!last && factsOf(read, last).lines === 'items';
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
	const leaf = leafHolding(doc, from, to)?.leaf;
	// A block whose lines are no body (a link definition) holds no pasted line: lines land as
	// blocks of their own under it, as at a caret on its syntax (§ 5.4 rule 7).
	const lined = !plain && (pasted.ended || lf.includes('\n'));
	if (lined && leaf && !factsOf(doc, leaf).holdsLines)
		return underBlock(doc, leaf, to, () => blocks().source, lf.endsWith('\n'));
	const landing = landed(doc, from, to, lf, plain, blocks, pasted.ended === true);
	if (!leaf) return landing;
	const lower = doc.layout.block([...leaf.path.slice(0, -1), leaf.path.at(-1)! + 1]);
	const flush = lower && lower.from <= pastMarkers(doc.source, leaf.to) ? lower : undefined;
	const joined = read && !plain && flush ? joinedBelow(doc, flush, landing, read) : landing;
	// What lands in an empty paragraph, its line ending alone, stays apart from the block under it.
	if (!/^\r?\n?$/.test(nodeAt(doc, leaf.path).raw))
		return blocksOpened(doc, leaf, to, lf, read, joined);
	if (titleOwner(doc, leaf) || factsOf(doc, leaf).joins !== 'text') return landing;
	const edit = read && !plain ? joinedAbove(doc, leaf, joined, read) : landing;
	const raw = flush ? lastPasted(doc, leaf, read?.source ?? lf, plain) : null;
	if (!lower || raw === null) return edit;
	const below = leaf.to + edit.source.length - doc.source.length;
	const join = { from, to, upper: leaf, lower, rewritten: { upper: { block: leaf, raw } } };
	return { source: apartAt(doc, edit.source, below, join, true), caret: edit.caret };
}

/** `edit` with the list `pasted` ends on joined, as items, to `lower`, a list of its own type flush
 *  under the caret's line: the empty line between the two goes. */
function joinedBelow(doc: Doc, lower: LaidBlock, edit: Edit, pasted: Doc): Edit {
	const last = pasted.tree.children.findLast((b) => !isBlankText(b.raw));
	if (!joinsList(doc, lower, last, false)) return edit;
	const { source } = edit;
	const line = lineStart(doc, lower.from) + source.length - doc.source.length;
	const above = source.lastIndexOf('\n', line - 2) + 1;
	if (!isBlankText(source.slice(pastMarkers(source, above), line))) return edit;
	const caret = edit.caret >= line ? edit.caret - (line - above) : edit.caret;
	return { source: source.slice(0, above) + source.slice(line), caret };
}

/** `edit`, a paste into the empty paragraph `leaf`, with the list `pasted` opens with joined to a
 *  list of its own type over it: the blank line between the two goes. */
function joinedAbove(doc: Doc, leaf: LaidBlock, edit: Edit, pasted: Doc): Edit {
	const first = pasted.tree.children.find((b) => !isBlankText(b.raw));
	const upper = doc.layout.block([...leaf.path.slice(0, -1), leaf.path.at(-1)! - 1]);
	// A paste that joined no list is the landing as it stood, the block it names with it.
	if (!upper || !joinsList(doc, upper, first, true)) return edit;
	const gap = lineStart(doc, leaf.from) - upper.to;
	const { source, caret } = edit;
	return { source: source.slice(0, upper.to) + source.slice(upper.to + gap), caret: caret - gap };
}

const lineStart = (doc: Doc, at: number) => at - lineHead(doc.source, at).length;

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
		// The opening fence line is the block's own syntax, which its write rule reads: an info
		// string holds no backtick, and a run grown at its end grows the closer with it.
		if (fence && target.from < fence.body) return write(clip);
		if (fence && displayLines(clip).some((line) => fence.mayClose(line.text))) return write(clip);
		// With no fence, a line stays in the block by its indent, which a new line repeats.
		const lineStart = raw.lastIndexOf('\n', target.from - 1) + 1;
		const indent = fence ? '' : /^[ \t]*/.exec(raw.slice(lineStart, target.from))![0];
		// The same bytes as the block's own: its text with the lines in, no container's markers, a
		// blank line bare where the source writes it bare (`spliced`).
		const textAfter = !isBlankText(lineRest(doc.source, to));
		const lines = displayLines(clip).map(({ text }, i, all) => {
			const bare = i === 0 || (text === '' && !(i === all.length - 1 && textAfter));
			return (bare ? '' : indent) + text;
		});
		const own = raw.slice(0, target.from) + lines.join(doc.ending) + raw.slice(target.to);
		const caret = own.length - (raw.length - target.to);
		// A one-line source shown while it's edited, given a line break, takes the shape typing gives
		// it: a one-line `$$` given two lines takes fence lines of its own.
		const oneLine = !/\n/.test(trimTrailingLineEnding(raw)) && /\n/.test(clip);
		const shown = oneLine && factsOf(doc, leaf).textPosition === 'while-source-shows';
		const shaped = shown ? doc.host.leaf.typed(doc.tree, leaf.path, own, caret) : null;
		if (shaped && shaped.bytes !== own)
			return writtenText(doc, leaf, shaped, target.from, target.to);
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
		const opened = (edit: Edit) => (follows ? edit : ownLine(doc, to, edit));
		if (ending && !isBlankText(text)) return opened(brokenAfter(write(text.slice(0, -1)), text));
		// Line breaks alone at a caret go in as bytes, which no write rule re-reads; spaces alone are
		// text the block writes, where a caret at a hidden edge places them.
		return from === to && isBlankText(text) && text.includes('\n')
			? opened(markersTrimmed(doc, from, bytes(text)))
			: write(text);
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
	// A closing line holds no text, so the text after the cut goes on a line of its own under it.
	const lastTakes = lastJoins && !closedByOwnLine(pasted, last!);
	const lastRaw = nodeAt(pasted, last!.path).raw;
	const joins = isText(first);
	const left = joins
		? null
		: (leftBy(doc, from, pasted, first, leaf) ?? unheld(doc, leaf, from, pasted, first));
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
		const cut = cutWith(inner.before, inner.after, behind);
		// A closing line that ends the clipboard holds no text: what follows the caret goes under it,
		// and the caret stays at that line's end, whose last place is the body's.
		const closed = follows && last === first && closedByOwnLine(pasted, first);
		const set = around(cut, closed ? inner.mid + '\n' : inner.mid, keep);
		const above = set.source.lastIndexOf('\n', set.caret - 1);
		const lineEnd = set.source[above - 1] === '\r' ? above - 1 : above;
		const edit = closed ? { ...set, caret: lineEnd } : set;
		const item = leaf.path[taker.path.length];
		return numberedAfterTaking(doc, taker, item, closedBy(doc, pasted, first, taker, edit));
	}
	// A clipboard opening with a line break or a paragraph joins the text before the caret; text
	// after it that the last block can't take goes on a line of its own, apart where it must be.
	if (joins || clip.startsWith('\n')) {
		const before = clip.startsWith('\n') ? '' : clip.slice(0, contentEnd(pasted, first));
		const after = tailOf(lastTakes && (last !== first || before === ''));
		const cut = cutWith(before, after, lead);
		const visible = lineRest(cut.rest, 0) !== '';
		const apart = !lastTakes && visible && !clip.endsWith('\n');
		const ends = !lastTakes && !visible;
		const text = apart ? clip + '\n' : ends ? intoBlankUnder(doc, to, clip) : clip;
		const edit = around(cut, text.slice(before.length, text.length - after.length));
		if (lastTakes) return restUnder(doc, edit, leaf, to, cut, lastRaw);
		const ending = apart ? edit.source.lastIndexOf('\n', edit.caret - 1) : edit.caret;
		const caret = apart && edit.source[ending - 1] === '\r' ? ending - 1 : ending;
		return restApart(doc, { source: edit.source, caret }, leaf, to, cut, lastRaw);
	}
	const under = doc.source.slice(leaf.text!.from, from) !== '';
	// A box stands in front of text alone (GFM task lists): a block of lines that is no text, pasted
	// at a to-do's text start, takes the text's place in the bullet, and the box goes.
	const box = under
		? null
		: boxBefore(doc, leaf, clip.slice(first.from, contentEnd(pasted, first)));
	if (box) return landedWithout(doc, box, from - box.length, to - box.length, clip);
	// Under text the last block joins what follows; with none before the cut only a paragraph's
	// text joins it, and only where the clipboard ends on no line ending.
	const flush = !isBlankText(onLine) && factsOf(doc, leaf).joins === 'text' && !clip.endsWith('\n');
	const after = tailOf(lastTakes && (under || flush));
	const cut = cutWith('', after, lead);
	// A heading left with no text gives way: the blocks land on its line as on an empty one.
	if (cut.empty && cut.head.length > leaf.from) {
		const heading = { from: leaf.from, length: contentEnd(doc, leaf) - leaf.from };
		return landedWithout(doc, heading, leaf.from, leaf.from, clip);
	}
	const ends = !lastTakes && lineRest(cut.rest, 0) === '';
	const text = ends ? intoBlankUnder(doc, to, clip) : clip;
	const mid = text.slice(0, text.length - after.length);
	return splitAt(doc, leaf, from, to, cut, mid, lastTakes, lastRaw);
}

/** The clipboard as blocks of their own under `leaf`, the block at `at`, set apart from it; `ended`:
 *  its last line ending opens the line under them, the caret's, as at a text's end. */
function underBlock(
	doc: Doc,
	leaf: LaidBlock,
	at: number,
	read: () => string,
	ended: boolean
): Edit {
	const parent = leaf.path.slice(0, -1);
	const below = doc.layout.block([...parent, leaf.path.at(-1)! + 1]);
	const edit = pasteApart(doc, below?.from ?? leaf.to, read, parent, true)!;
	if (!ended || onBlankLine(edit)) return edit;
	// The last child's line stays in its container; elsewhere the blank line under is the line.
	if (!below) return ownLine(doc, at, edit);
	const line = pastMarkers(edit.source, lineEnd(edit.source, edit.caret) + 1);
	return isBlankText(lineRest(edit.source, line)) ? { ...edit, caret: line } : edit;
}

/** The caret's list, where `first`, a pasted block, goes on its item's own line past the marker and
 *  that line reads back as no item: the item gives way to it, as to a list of the other type. */
function unheld(doc: Doc, leaf: LaidBlock, from: number, pasted: Doc, first: LaidBlock) {
	const item = leaf.path.at(-1) === 0 && from === leaf.text!.from ? parentOf(doc, leaf) : undefined;
	const list = item && parentOf(doc, item);
	if (!list || factsOf(doc, list).lines !== 'items') return null;
	const marker = doc.source.slice(item.lineAt!(item.from).from, leaf.text!.from).trimStart();
	const line = displayLines(nodeAt(pasted, first.path).raw)[0]?.text ?? '';
	const read = readDoc(marker + line + doc.ending, doc.host, doc.mode);
	const top = read.layout.block([0]);
	return top && factsOf(read, top).lines === 'items' ? null : list;
}

/** The to-do box in front of `leaf`'s text, where `first`, a pasted block that is no text, holds
 *  more than one line; null for any other block. */
function boxBefore(doc: Doc, leaf: LaidBlock, first: string): Span | null {
	const item = first.includes('\n') && leaf.path.at(-1) === 0 ? parentOf(doc, leaf) : undefined;
	const box = item && metadataIfKind(nodeAt(doc, item.path), 'listItem')?.taskMarker;
	const at = leaf.text!.from;
	return box && doc.source.endsWith(box, at) ? { from: at - box.length, length: box.length } : null;
}

interface Span {
	from: number;
	length: number;
}

/** The paste of `clip` at `[from, to)` of the document with `cut` taken out, its bytes and caret
 *  alone: a block that landing names is one of that other document. */
function landedWithout(doc: Doc, cut: Span, from: number, to: number, clip: string): Edit {
	const bare = doc.source.slice(0, cut.from) + doc.source.slice(cut.from + cut.length);
	const without = { ...readDoc(bare, doc.host, doc.mode), ending: doc.ending };
	const landing: Pasted = { text: clip, plain: false, held: { holds: 'text' }, transform: null };
	const { source, caret } = pasteAt(without, from, to, landing);
	return { source, caret };
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

/** `edit`, blocks pasted with a last line ending at the end of a contained block's text: where the
 *  last of them takes text, the line the ending opens is the container's, as text's is. */
function blocksOpened(
	doc: Doc,
	leaf: LaidBlock,
	to: number,
	clip: string,
	read: Doc | undefined,
	edit: Edit
): Edit {
	if (!read || leaf.path.length < 2 || !clip.endsWith('\n') || !onBlankLine(edit)) return edit;
	const tops = read.tree.children.flatMap((b, i) => (isBlankText(b.raw) ? [] : [i]));
	const last = tops.length ? read.layout.block([tops.at(-1)!]) : undefined;
	const joins = last && factsOf(read, last).joins;
	// One paragraph landed as text, whose ending opened its line already.
	if (!joins || joins === 'never' || (tops.length === 1 && joins === 'text')) return edit;
	return ownLine(doc, to, edit);
}

/** `edit`, whose last line ending opened the caret's line at a container's last block, with the
 *  container's own empty line under it for the caret; the top level keeps § 5.6's bytes. */
function ownLine(doc: Doc, at: number, edit: Edit): Edit {
	const leaf = leafHolding(doc, at, at)?.leaf;
	const parent = leaf && parentOf(doc, leaf);
	// In a list item the ending is Enter's next item (`entered`); under a block with a sibling below,
	// the line under the caret's is the container's already.
	if (!parent || itemHolding(doc, at, at)) return edit;
	if (doc.layout.block([...parent.path, leaf!.path.at(-1)! + 1])) return edit;
	const marks = continuation(doc, at);
	// A container that marks its lines with an indent alone keeps it on an empty one.
	const empty = marks.trimEnd() || marks;
	const under = ({ source, caret }: Edit, move: boolean): Edit => {
		const end = lineEndBefore(source, caret);
		const line = doc.ending + empty;
		const out = source.slice(0, end) + line + source.slice(end);
		return { source: out, caret: move ? end + line.length : caret };
	};
	const opened = under(edit, true);
	// A closing line keeps a blank line of its own over it, as Enter leaves one.
	if (!closedByOwnLine(doc, parent)) return opened;
	const below = lineEnd(opened.source, opened.caret) + 1;
	return lineRest(opened.source, below) === empty ? opened : under(opened, false);
}

/** `edit`, line breaks at `at`, with the line they leave blank, when `at` stood right past its line's
 *  markers, keeping those markers without their trailing spaces, as Enter leaves it. */
function markersTrimmed(doc: Doc, at: number, edit: Edit): Edit {
	const head = lineHead(doc.source, at);
	const kept = head.trimEnd();
	// Spaces alone mark no container: they are the line's own bytes.
	if (kept === head || kept === '' || pastMarkers(head, 0) !== head.length) return edit;
	const start = at - head.length + kept.length;
	const source = edit.source.slice(0, start) + edit.source.slice(at);
	return { source, caret: edit.caret - (head.length - kept.length) };
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
