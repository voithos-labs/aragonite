/**
 * Pasted blocks that land as blocks of their own: the block at the caret is cut there (`Cut`, the
 * halves a split leaves) and the pasted blocks go between its halves, or the caret's list splits,
 * where a pasted list leaves it. At a place between blocks they stand a blank line apart from the
 * block either side; at a text caret in no block's text, only where two would read as one.
 */

import { isBlankText } from '../core/lines';
import { metadataIfKind } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import { itemsShareList } from '../tree-operations/list/ordered-markers';
import type { LaidBlock } from './layout';
import { openedApart, pastMarkers } from './apart';
import {
	closedByOwnLine,
	containersHolding,
	contentEnd,
	factsOf,
	findWithin,
	holderAt,
	isCell,
	lastLine,
	leafHolding,
	multiline,
	nodeAt,
	parentOf,
	readDoc,
	titleOwner,
	type Doc
} from './document';
import {
	numberedAfterSplit,
	numberedAfterTaking,
	numberedFromHead,
	numberedOn
} from './list-numbers';
import { continuation } from './markers';
import { cutLeaf, spliced, type Cut, type Edit } from './leaf-splice';
import { lineEnd, lineHead, lineRest } from './lines';

/** The list item whose own block holds `[from, to)` in its text, with that block and its list;
 *  null elsewhere, and in literal text, where Enter adds a line. */
export function itemHolding(doc: Doc, from: number, to: number) {
	const held = leafHolding(doc, from, to);
	return held && factsOf(doc, held.leaf).body !== 'literal' ? itemAround(doc, held) : null;
}

/** The list item whose own block is `held`'s, with its list; null outside a list. */
export function itemAround(doc: Doc, held: NonNullable<ReturnType<typeof leafHolding>>) {
	const item = parentOf(doc, held.leaf);
	const list = item && parentOf(doc, item);
	return list && factsOf(doc, list).lines === 'items' ? { held, item, list } : null;
}

/** Whether `leaf` is literal text whose lines take a pasted line, where Enter adds a line. */
export function literalLines(doc: Doc, leaf: LaidBlock): boolean {
	const facts = factsOf(doc, leaf);
	return facts.body === 'literal' && facts.holdsLines;
}

/** The list item a paste landed in, and what an item Enter opens after it starts with. */
export interface HostItem {
	node: NodeView;
	marker: string;
	depth: number;
}

/** Enter at `caret`, where a paste ended, in a list holding an item the document had (its first byte
 *  `own`) or nested in `host`, the item pasted in; under a pasted list alone, `host`'s next item. */
export function enteredAt(
	doc: Doc,
	caret: number,
	host: HostItem | undefined,
	own: (byte: number) => boolean
): Edit | null {
	const there = itemHolding(doc, caret, caret) ?? (host ? hostHolding(doc, caret, host) : null);
	const item = there?.item ?? endedItem(doc, caret);
	const list = item && parentOf(doc, item);
	if (!item || !list) {
		const block = host && brokeOut(doc, caret, host);
		return block ? openedUnder(doc, block, host) : null;
	}
	// A list nested deeper than the host's item opens its own next item, as Enter there does.
	const nested = !!host && item.path.length > host.depth;
	// The pasted items joined that list where it holds one of the document's of their own type.
	const node = nodeAt(doc, item.path);
	const joined = (nodeAt(doc, list.path).children ?? []).some((other, i) => {
		const laid = doc.layout.block([...list.path, i]);
		return !!laid && own(laid.from) && itemsShareList(other, node);
	});
	if (!nested && !joined) return host ? openedUnder(doc, list, host) : null;
	const ownKind = doc.host.itemAfter(doc.tree, item.path);
	const held = there?.held;
	const none = { before: '', after: '', lead: '' };
	const cut = held
		? cutLeaf(doc, held.leaf, held.from, held.to, none)
		: { head: doc.source.slice(0, caret), rest: doc.source.slice(caret), caret: 0 };
	const outer = continuation(doc, caret, (c) => c !== list);
	const first = item.lineAt!(item.from);
	const indent = /^[ \t]*/.exec(doc.source.slice(first.from, first.markerTo))![0];
	// The host's kind is for its own list: an item of a list around it opens that list's next item.
	const hosted = host && item.path.length === host.depth;
	const marker = hosted ? numberedAs(host.marker, ownKind) : ownKind;
	const head = cut.head + doc.ending + outer + indent + marker;
	// Text of the block on a later line comes up behind the new marker, as Enter's split brings it.
	const later = !!held && caret < held.leaf.text!.to && /^\r?\n/.test(cut.rest);
	const rest = later ? cut.rest.slice(pastMarkers(cut.rest, cut.rest.indexOf('\n') + 1)) : cut.rest;
	const opened = { source: head + rest, caret: head.length + cut.caret };
	// Enter at an item's text start leaves it a blank first line, which keeps the line above apart.
	const apart = held ? openedApart(doc, held.leaf, opened) : opened;
	return atTextStart(doc, numberedAfterTaking(doc, list, item.path.at(-1)! + 1, apart));
}

/** `host`, the item pasted in, where the text at `caret` sits in a block the paste nested in it (a
 *  quote): the ending is the host's Enter there, not the nested block's. */
function hostHolding(doc: Doc, caret: number, host: HostItem) {
	const held = leafHolding(doc, caret, caret);
	const item = held && containersHolding(doc, caret).find((c) => c.path.length === host.depth);
	const list = item && parentOf(doc, item);
	if (!held || !list || factsOf(doc, list).lines !== 'items') return null;
	// A cell holds one line and literal text takes the ending: neither is text the item splits.
	const own = factsOf(doc, held.leaf).body !== 'literal' && !isCell(doc, held.leaf);
	// A block that took none of the item's text after the caret (a footnote) splits nothing of it.
	const joined = caret < held.leaf.text!.to;
	return own && joined ? { held, item, list } : null;
}

/** The block a paste broke the host's list around, its content ending at `caret`. */
const brokeOut = (doc: Doc, caret: number, host: HostItem) =>
	[...doc.layout.within(caret, caret)].find(
		(b) => b.path.length === host.depth - 1 && contentEnd(doc, b) === caret
	);

/** `edit` with a caret left on its line's markers at that line's text start, where Enter leaves it:
 *  a space or tab the rest starts with becomes the new marker's padding. */
function atTextStart(doc: Doc, edit: Edit): Edit {
	const { source, caret } = edit;
	const read = readDoc(source, doc.host, doc.mode);
	const leaf = [...read.layout.within(caret, lineEnd(source, caret))].find(
		(b) => b.text && b.text.from >= caret
	);
	const start = leaf?.text?.from;
	return start !== undefined && /^[ \t]*$/.test(source.slice(caret, start))
		? { ...edit, caret: start }
		: edit;
}

/** `marker` with the number `other` starts with, where both are an ordered item's. */
function numberedAs(marker: string, other: string | undefined): string {
	const number = other && /^\d+/.exec(other)?.[0];
	return number ? marker.replace(/^\d+/, number) : marker;
}

/** `host`'s next item under `block`, pasted blocks that broke out of the host's list: it heads the
 *  host's items below, numbered on, apart from `block` where a reload would read its marker into it. */
function openedUnder(doc: Doc, block: LaidBlock, host: HostItem): Edit {
	const { source } = doc;
	const end = contentEnd(doc, block);
	const outer = continuation(doc, end, (c) => c !== block);
	const listed = factsOf(doc, block).lines === 'items';
	const first = listed ? doc.layout.block([...block.path, 0]) : undefined;
	const line = first?.lineAt!(first.from);
	const indent = line ? /^[ \t]*/.exec(source.slice(line.from, line.markerTo))![0] : '';
	const next = doc.layout.block([...block.path.slice(0, -1), block.path.at(-1)! + 1]);
	const head = next && nodeAt(doc, next.path).children?.[0];
	const below = head && itemsShareList(host.node, head) ? next : undefined;
	// Past the blank lines over the host's items below, so the item opened is the first of them.
	const above = below ? source.lastIndexOf('\n', below.from - 1) : -1;
	const at = above < 0 ? end : source[above - 1] === '\r' ? above - 1 : above;
	const opens = doc.ending + outer + indent + host.marker;
	const out = source.slice(0, at) + opens + source.slice(at);
	const under = at + doc.ending.length;
	const stands = at > end || startsBlock(doc, out, under, block.path.length);
	const apart = stands ? '' : outer.trimEnd() + doc.ending;
	const opened = {
		source: out.slice(0, under) + apart + out.slice(under),
		caret: at + opens.length + apart.length
	};
	return below ? numberedFromHead(doc, below, opened) : opened;
}

/** `clip` with its trailing blank line, a separation, taken into the blank line under the line
 *  holding `at`, where one stands there or the document ends. */
export function intoBlankUnder(doc: Doc, at: number, clip: string): string {
	const under = Math.min(lineEnd(doc.source, at) + 1, doc.source.length);
	const blank = isBlankText(lineRest(doc.source, pastMarkers(doc.source, under)));
	return blank ? clip.replace(/\n[ \t]*\n$/, '\n') : clip;
}

/** The list item whose content ends at `caret`. */
function endedItem(doc: Doc, caret: number): LaidBlock | undefined {
	const inList = (c: LaidBlock) => {
		const list = parentOf(doc, c);
		return !!list && factsOf(doc, list).lines === 'items';
	};
	const item = containersHolding(doc, caret).findLast(inList);
	return item && contentEnd(doc, item) === caret ? item : undefined;
}

/** A pasted list of another kind than `list`, the caret's: the pasted blocks land between the
 *  list's halves, and what the caret's item holds after the cut is the second half's first item. */
export function splitOut(
	doc: Doc,
	list: LaidBlock,
	leaf: LaidBlock,
	at: number,
	to: number,
	cut: Cut,
	clip: string,
	last: string
): Edit {
	const { source } = doc;
	const eol = doc.ending;
	const outside = (c: LaidBlock) => c !== list;
	const outer = continuation(doc, at, outside);
	const item = parentOf(doc, leaf)!;
	const first = item.lineAt!(item.from);
	// The pasted list stands in the caret list's column, or one would nest in the other: its lines
	// lose the indent the clipboard's first line brings and take the one before the item's marker.
	const brought = /^\n*( *)/.exec(clip)![1].length;
	const body = clip.replace(/\n$/, '').replace(new RegExp(`^ {0,${brought}}`, 'gm'), '');
	const indent = /^[ \t]*/.exec(source.slice(first.from, first.markerTo))![0];
	const pasted =
		(body.startsWith('\n') ? '' : indent) + spliced(doc, at, to, outside, indent)(body);
	// With no text of the item before the cut the whole item is the second half; with none after it
	// either it has none to be an item of, and gives way to the items under it.
	const textFrom = leaf.text!.from;
	const whole = (cut.empty || cut.head.length <= textFrom) && leaf.path.at(-1) === 0;
	const grown = cut.rest.length - (source.length - to);
	const rest = !isBlankText(cut.rest.slice(0, contentEnd(doc, item) - to + grown));
	const head = whole ? source.slice(0, first.from) + pasted : cut.head + eol + outer + pasted;
	const tail = !whole && rest;
	const own = whole ? Math.min(cut.head.length, textFrom) : first.markerTo;
	const marker = rest ? eol + outer + source.slice(first.from, own) : '';
	const copyAt = tail ? head.length + eol.length + outer.length : null;
	const out = head + marker + cut.rest;
	const numbered = !whole
		? numberedAfterSplit(doc, list, item.path.at(-1)!, to, out, copyAt)
		: rest
			? out
			: numberedOn(doc, first.from, to, out);
	const under = lineEnd(numbered, head.length) + 1;
	const [path, index] = [list.path.slice(0, -1), list.path.at(-1)!];
	// The pasted blocks stay apart from the block over the list, or the list's own first half, where
	// the two would read as one (a rule under text is its underline; one in the list's marker, an item).
	const nth = item.path.at(-1)!;
	const items = nodeAt(doc, list.path).children ?? [];
	const half = items.slice(0, nth).map((c) => c.leadingTrivia + c.raw);
	const block = whole && nth === 0 ? doc.layout.block([...path, index - 1]) : undefined;
	const above = block ? nodeAt(doc, block.path).raw : whole && nth > 0 ? half.join('') : null;
	const apartAbove = (edit: Edit): Edit => {
		if (above === null) return edit;
		const line = first.from - lineHead(source, first.from).length;
		const upper = {
			path,
			index: block ? index - 1 : index,
			upper: above,
			lower: body,
			placed: true
		};
		const out = parted(doc, edit.source, line, outer, upper);
		return { source: out, caret: edit.caret + out.length - edit.source.length };
	};
	// With no item left under the pasted blocks, what stood under the list may sit outside its
	// parent, where the pair's question has no slot: the new bytes say whether it still starts a block.
	const ended = marker === '' && !doc.layout.block([...list.path, item.path.at(-1)! + 1]);
	if (ended && under < numbered.length) {
		const starts = startsBlock(doc, numbered, under, list.path.length);
		return apartAbove({
			source: starts ? numbered : parted(doc, numbered, under, outer, null),
			caret: head.length
		});
	}
	const lower = numbered.slice(under + outer.length, lineEnd(numbered, under));
	const pair = { path, index, upper: last, lower, placed: true };
	return apartAbove({ source: parted(doc, numbered, under, outer, pair), caret: head.length });
}

/** Whether a block no deeper than `depth` starts on the line of `out` that starts at `line`. */
function startsBlock(doc: Doc, out: string, line: number, depth: number): boolean {
	const end = lineEnd(out, line);
	if (isBlankText(out.slice(line, end))) return true;
	const read = readDoc(out, doc.host, doc.mode);
	const there = (b: LaidBlock) => b.path.length <= depth && b.from >= line && b.from < end;
	return findWithin(read, line, end, there) !== undefined;
}

/** Two blocks a paste leaves touching, children `index` and `index + 1` of the block at `path`
 *  once it lands, each by its own bytes; `placed` where the lower one must stay a block of its own,
 *  `always` where the two stay apart whatever they read as, `bare` where the upper one is the
 *  clipboard whole and its markers alone (a `>` with no text). */
interface Touching {
	path: readonly number[];
	index: number;
	upper: string;
	lower: string;
	placed: boolean;
	always?: boolean;
	bare?: boolean;
}

/** `out` with a blank line behind `marks` opened at `line`, where the lower block's line starts,
 *  when `pair` would read as one block without it; with no pair, wherever none stands there. */
function parted(doc: Doc, out: string, line: number, marks: string, pair: Touching | null): string {
	const above = out.lastIndexOf('\n', line - 2) + 1;
	const ended = (raw: string) => ({ raw: raw.replace(/\n?$/, '\n') });
	// A bare upper block's line is no blank line over the lower one: with text typed in it, it takes
	// the line under it as its own.
	const touching =
		line > 0 &&
		!isBlankText(lineRest(out, pastMarkers(out, line))) &&
		(!!pair?.bare || !isBlankText(out.slice(pastMarkers(out, above), line)));
	const apart =
		touching &&
		(!pair ||
			pair.always ||
			(!isBlankText(pair.lower) &&
				doc.host.parts(
					doc.tree,
					pair.path,
					pair.index,
					ended(pair.upper),
					ended(pair.lower),
					pair.placed,
					// The pair stands where child `index` stood, so a block above that waits is asked too.
					pair.index
				)));
	return apart ? out.slice(0, line) + marks.trimEnd() + doc.ending + out.slice(line) : out;
}

/** `edit` left `last`, a pasted block that takes no text, over the second half of `cut`, or over
 *  the block flush under `leaf`: a blank line between the two where they would read as one. */
export function restApart(
	doc: Doc,
	edit: Edit,
	leaf: LaidBlock,
	to: number,
	cut: Cut,
	last: string
): Edit {
	const shift = edit.source.length - doc.source.length;
	const from = edit.source.length - cut.rest.length;
	const [path, index] = [leaf.path.slice(0, -1), leaf.path.at(-1)!];
	const next = isBlankText(cut.tail) ? doc.layout.block([...path, index + 1]) : undefined;
	const flush = next && next.from <= pastMarkers(doc.source, leaf.to);
	const line = flush
		? leaf.to + shift
		: cut.follows
			? edit.source.lastIndexOf('\n', from - 1) + 1
			: lineEnd(edit.source, from) + 1;
	const lower = flush ? nodeAt(doc, next.path).raw : cut.tail;
	const pair = { path, index, upper: last, lower, placed: true };
	const source = parted(doc, edit.source, line, continuation(doc, to), pair);
	// A caret past a pasted last line ending stays over the rest, on the blank line.
	const blank = source.length - edit.source.length - doc.ending.length;
	return { source, caret: blank >= 0 && edit.caret > line ? line + blank : edit.caret };
}

/** `edit` left `cut`'s second half on the line a last line ending opened under `last`, a pasted
 *  block that takes text: a blank line parts the two where `last` would read the half in. */
export function restUnder(
	doc: Doc,
	edit: Edit,
	leaf: LaidBlock,
	to: number,
	cut: Cut,
	last: string
): Edit {
	const from = edit.source.length - cut.rest.length;
	const line = edit.source.lastIndexOf('\n', from - 1) + 1;
	// A half joined to the last block, or still on its line, has no line of its own to keep.
	if (!cut.follows || cut.joined || pastMarkers(edit.source, line) < from) return edit;
	const [path, index] = [leaf.path.slice(0, -1), leaf.path.at(-1)!];
	const pair = { path, index, upper: last, lower: cut.tail, placed: true };
	const source = parted(doc, edit.source, line, continuation(doc, to), pair);
	return { source, caret: edit.caret + source.length - edit.source.length };
}

/** Whether `c` is the block at `parent` or a block around it. */
const holding = (parent: readonly number[]) => (c: LaidBlock) =>
	c.path.length <= parent.length && c.path.every((p, i) => p === parent[i]);

/** Where the children of `holder` end: at its closing line, its own end, or the document's. */
function bodyEnd(doc: Doc, holder: LaidBlock | undefined): number {
	if (!holder) return doc.source.length;
	const fenced = closedByOwnLine(doc, holder);
	return fenced ? lastLine(holder).from : holder.to;
}

/** A clipboard set among a container's children on lines of its own. */
interface SetIn extends Edit {
	/** Where its first line went in: the place, or the holder's end for a byte past it. */
	place: number;
	/** Where the first pasted line starts in the new bytes, and the markers it stands behind. */
	line: number;
	marks: string;
	/** Where the pasted bytes end, the markers of the line under them, and whether that line is
	 *  what followed the place on its own. */
	stop: number;
	under: string;
	follows: boolean;
	/** The place is where its line's text starts, so the block above ends before that line. */
	leads: boolean;
}

/** `clip` on lines of its own at `at`, a place between the children of `holder`: what follows the
 *  place on its line starts the line under, and a first line its line's markers don't reach takes them. */
function setIn(doc: Doc, at: number, holder: LaidBlock | undefined, clip: string): SetIn {
	const { source } = doc;
	const eol = doc.ending;
	const end = bodyEnd(doc, holder);
	const past = at >= end;
	const place = past ? end : at;
	const inside = holding(holder?.path ?? []);
	// Past the holder's last child, a new line starts as that child's last line does.
	const from = past ? Math.max(place - 1, 0) : place;
	const prefix = continuation(doc, from, inside);
	const head = lineHead(source, place);
	const marked = pastMarkers(source, place - head.length) >= place;
	const reached = prefix.startsWith(head) ? prefix.slice(head.length) : '';
	// After a last line with no ending the clipboard opens a line of its own.
	const lead = marked ? reached : past ? eol + prefix : '';
	const rest = past ? place < source.length : !isBlankText(lineRest(source, place));
	// The line break that sets what follows on its own line stands for the clipboard's last one.
	const follows = !isBlankText(clip) && rest;
	const pasted = lead + spliced(doc, from, from, inside)(follows ? clip.replace(/\n$/, '') : clip);
	// What follows a holder's end is outside it, behind the markers its own line has.
	const under = past ? (marked ? head : '') : prefix;
	const out = source.slice(0, place) + pasted + (follows ? eol + under : '') + source.slice(place);
	const stop = place + pasted.length;
	const line = out.lastIndexOf('\n', place + lead.length - 1) + 1;
	const marks = marked || past ? out.slice(line, place + lead.length) : '';
	const leads = marked || past;
	return { source: out, caret: stop, place, line, marks, stop, under, follows, leads };
}

/** The clipboard as blocks of its own at `at`, between the children of the block at `parent`: with
 *  `always` a blank line apart from the block either side, else only where two would read as one. */
export function pasteApart(
	doc: Doc,
	at: number,
	read: () => string,
	parent: readonly number[],
	always: boolean
): Edit | null {
	const named = parent.length ? doc.layout.block(parent) : undefined;
	// A path that names no container is read as the container around the place.
	const holder = parent.length === 0 || named?.container ? named : holderAt(doc, at);
	// Among a table's rows no block stands, and the clipboard stays unread.
	if (holder && factsOf(doc, holder).lines === 'rows') return null;
	const clip = read();
	return setApart(doc, setIn(doc, at, holder, clip), holder, clip, true, always);
}

/** `clip` on the empty line at `at` that no block holds: its first and last blocks stay apart from
 *  the block either side where the two would read as one, save a list of its own type, which it joins. */
export function onEmptyLine(doc: Doc, at: number, clip: string): Edit {
	const holder = holderAt(doc, at);
	return setApart(doc, setIn(doc, at, holder, clip), holder, clip, true, false);
}

/** Whether the pasted list `block` joins the list `beside` it as items once nothing parts the two:
 *  both ordered or both bullets, whatever glyph each writes (`glyphsTaken` spells them one). */
export function joinsList(
	doc: Doc,
	beside: LaidBlock | undefined,
	block: NodeView | undefined
): boolean {
	if (!beside || beside.type !== block?.kind || factsOf(doc, beside).lines !== 'items')
		return false;
	return isOrdered(nodeAt(doc, beside.path)) === isOrdered(block);
}

const isOrdered = (list: NodeView) => !!metadataIfKind(list, 'list')?.ordered;

/** `edit` with a blank line under the last block of `clip` and, with `above`, over its first: with
 *  `always` wherever none stands, else where the two blocks there would read as one. */
function setApart(
	doc: Doc,
	edit: SetIn,
	holder: LaidBlock | undefined,
	clip: string,
	above: boolean,
	always: boolean
): Edit {
	const blocks = readDoc(clip, doc.host, doc.mode).tree.children.filter((b) => !isBlankText(b.raw));
	const lines = holder ? factsOf(doc, holder).lines : 'none';
	if (blocks.length === 0 || lines === 'rows') return edit;
	const { source } = doc;
	const { place } = edit;
	// Between a list's items a pasted list is the list's own, and beside a list of its own type it
	// joins it as items unless a gap caret named the place: nothing keeps either from folding in.
	const path = holder?.path ?? [];
	const placed = (block: NodeView, beside: LaidBlock | undefined) =>
		!(lines === 'items' && block.kind === holder!.type) &&
		(always || !joinsList(doc, beside, block));
	const child = (b: LaidBlock) =>
		b.path.length === path.length + 1 && path.every((p, i) => p === b.path[i]);
	const next = pastMarkers(source, Math.min(lineEnd(source, place) + 1, source.length));
	const lower = findWithin(doc, place, next, (b) => child(b) && b.from >= place);
	const lowerRaw = lower ? nodeAt(doc, lower.path).raw : '';
	let out = edit.source;
	const under = out.indexOf('\n', edit.stop) + 1;
	if (!isBlankText(lowerRaw)) {
		const pair = {
			path,
			index: lower!.path.at(-1)!,
			upper: blocks.at(-1)!.raw,
			lower: lowerRaw,
			placed: placed(blocks.at(-1)!, lower)
		};
		const bare = blocks.length === 1 && /^[ \t>]*>[ \t>]*\r?\n?$/.test(pair.upper);
		out = parted(doc, out, under, edit.under, { ...pair, always: always && pair.placed, bare });
	} else if (always && under > 0 && !closes(doc, edit.follows ? place : next)) {
		// What follows the holder's last child is no child of it, yet a last pasted paragraph would
		// read it as its own next line: a blank line keeps it out, unless that line reads as a block.
		const read = readDoc(out, doc.host, doc.mode);
		const starts = (b: LaidBlock) => b.from >= under && b.from <= pastMarkers(out, under);
		if (!findWithin(read, under, pastMarkers(out, under), starts))
			out = parted(doc, out, under, edit.under, null);
	}
	const lineStart = place - lineHead(source, place).length;
	const reach = above && edit.leads ? [...doc.layout.within(lineStart, place)] : [];
	// A title row is its container's own line, never a block to stay apart from.
	const upper = reach.findLast((b) => child(b) && b.to <= place && !titleOwner(doc, b));
	if (!upper) return { source: out, caret: edit.caret };
	const pair = {
		path,
		index: upper.path.at(-1)!,
		upper: nodeAt(doc, upper.path).raw,
		lower: blocks[0].raw,
		placed: placed(blocks[0], upper)
	};
	// A block above that waits is asked with the run as the paste leaves it: where the clipboard
	// took the blank line over the lower block, that block stands flush under it.
	const taken = lower && out === edit.source && nodeAt(doc, lower.path).leadingTrivia !== '';
	const asLeft = taken ? { ...doc, tree: flushAt(doc.tree, path, lower.path.at(-1)!) } : doc;
	const grown = parted(asLeft, out, edit.line, edit.marks, {
		...pair,
		always: always && pair.placed
	});
	return { source: grown, caret: edit.caret + grown.length - out.length };
}

/** `tree` read with child `index` of the block at `path` flush under the child above it. */
function flushAt(tree: DocumentView, path: readonly number[], index: number): DocumentView {
	const flushed = (children: readonly NodeView[], at: readonly number[]): NodeView[] => {
		const copy = [...children];
		const [step, ...rest] = at;
		if (step === undefined) copy[index] = { ...copy[index], leadingTrivia: '' } as NodeView;
		else
			copy[step] = {
				...copy[step],
				children: flushed(copy[step].children ?? [], rest)
			} as NodeView;
		return copy;
	};
	return { ...tree, children: flushed(tree.children, path) };
}

/** Whether `byte` sits on the line that closes a container. */
function closes(doc: Doc, byte: number): boolean {
	const closing = (c: LaidBlock) => {
		if (!c.lineAt || !multiline(c)) return false;
		const last = lastLine(c);
		return last.own && last.from <= byte && byte < last.to;
	};
	return findWithin(doc, byte, byte, closing) !== undefined;
}

/** The pasted blocks between the halves of `cut`, the caret's block cut at `[at, to)`; `lastJoins`:
 *  the last of them, `last`, takes the text after the cut. */
export function splitAt(
	doc: Doc,
	leaf: LaidBlock,
	at: number,
	to: number,
	cut: Cut,
	clip: string,
	lastJoins: boolean,
	last: string
): Edit {
	const overRest = (edit: Edit) =>
		(lastJoins ? restUnder : restApart)(doc, edit, leaf, to, cut, last);
	const { source } = doc;
	const eol = doc.ending;
	const prefix = continuation(doc, at);
	const blank = prefix.trimEnd();
	// A paragraph the clipboard ends on is joined to the second half already.
	const { joined } = cut;
	const lines = spliced(doc, at, to, undefined, '', joined || undefined);
	const { head } = cut;
	const before = head.slice(leaf.from);
	if (before !== '') {
		// The head keeps its line, a blank line under it (a head of blanks is one already), then the
		// clipboard as written; the tail joins the last block that takes joined text, else is a paragraph.
		const closing = cut.follows && !lastJoins ? eol + prefix : '';
		// A line a last line ending opens over a tail set on its own line is blank: markers trimmed.
		const written = lines(clip);
		const blankLast = closing !== '' && clip.endsWith('\n') && written.endsWith(prefix);
		const body = blankLast ? written.slice(0, written.length - prefix.length) + blank : written;
		const opening = (isBlankText(before) ? eol : eol + blank + eol) + prefix + body;
		const caret = head.length + opening.length + cut.caret;
		return overRest({ source: head + opening + closing + cut.rest, caret });
	}
	// With nothing before the cut the blocks go on lines over the second half, save text the last
	// block takes, which a last line ending splits off as mid-text; with nothing after, it opens a line.
	const splitOff = cut.follows && lastJoins && factsOf(doc, leaf).joins === 'text';
	const body =
		joined || splitOff
			? clip
			: cut.follows
				? clip.replace(/\n$/, '')
				: intoBlankUnder(doc, to, clip);
	const opening = lines(body);
	// An empty line that text follows right after stays, keeping the pasted blocks apart from it;
	// a line the paste took the text of was never empty, nor is an empty item's, its marker's.
	const under = Math.min(lineEnd(source, to) + 1, source.length);
	const next = lineRest(source, pastMarkers(source, under));
	const emptied = at === to && !cut.follows && !body.endsWith('\n') && !isBlankText(next);
	const item = emptied ? itemHolding(doc, at, to)?.item : undefined;
	const kept = emptied && !item ? eol + blank : '';
	const apart = eol + (body !== clip ? blank + eol : '') + prefix;
	const taken = joined || (factsOf(doc, leaf).joins === 'text' && lastJoins && body === clip);
	const closing = cut.follows ? (taken ? '' : apart) : kept;
	// The last line ending taken off stands for the empty line it opens, which takes the caret.
	const opened = cut.follows && !taken && body !== clip ? eol.length + blank.length : 0;
	const caret = head.length + opening.length + opened + cut.caret;
	const out = head + opening + closing + cut.rest;
	// Under an empty item the next line gets a blank line only where the pasted blocks would read it
	// in: no block beside them starts there.
	const line = lineEnd(out, head.length + opening.length) + 1;
	const readIn = item && !startsBlock(doc, out, line, item.path.length + 1);
	return overRest({ source: readIn ? parted(doc, out, line, prefix, null) : out, caret });
}
