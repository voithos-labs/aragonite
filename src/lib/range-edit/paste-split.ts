/**
 * Pasted blocks that land as blocks of their own: the block at the caret is cut there (`Cut`, the
 * halves a split leaves) and the pasted blocks go between its halves, or the caret's list splits,
 * where a pasted list leaves it. At a place between blocks they stand a blank line apart from the
 * block either side; at a text caret in no block's text, only where two would read as one.
 */

import { isBlankText } from '../core/lines';
import type { NodeView } from '../core/node-views';
import { itemsShareList } from '../tree-operations/list/ordered-markers';
import type { LaidBlock } from './layout';
import { pastMarkers } from './apart';
import {
	contentEnd,
	factsOf,
	findWithin,
	holderAt,
	nodeAt,
	parentOf,
	readDoc,
	titleOwner,
	type Doc
} from './document';
import { numberedAfterSplit, numberedOn } from './list-numbers';
import { continuation } from './markers';
import { lineEnd, lineHead, lineRest, spliced, type Cut, type Edit } from './leaf-splice';

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
	const first = item.lines![0];
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
	// With no item left under the pasted blocks, what stood under the list may sit outside its
	// parent, where the pair's question has no slot: the new bytes say whether it still starts a block.
	const ended = marker === '' && !doc.layout.block([...list.path, item.path.at(-1)! + 1]);
	if (ended && under < numbered.length) {
		const starts = startsBlock(doc, numbered, under, list.path.length);
		return {
			source: starts ? numbered : parted(doc, numbered, under, outer, null),
			caret: head.length
		};
	}
	const lower = numbered.slice(under + outer.length, lineEnd(numbered, under));
	const [path, index] = [list.path.slice(0, -1), list.path.at(-1)!];
	const pair = { path, index, upper: last, lower, placed: true };
	return { source: parted(doc, numbered, under, outer, pair), caret: head.length };
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
 *  once it lands, each by its own bytes; `placed` where the lower one must stay a block of its own. */
interface Touching {
	path: readonly number[];
	index: number;
	upper: string;
	lower: string;
	placed: boolean;
}

/** `out` with a blank line behind `marks` opened at `line`, where the lower block's line starts,
 *  when `pair` would read as one block without it; with no pair, wherever none stands there. */
function parted(doc: Doc, out: string, line: number, marks: string, pair: Touching | null): string {
	const above = out.lastIndexOf('\n', line - 2) + 1;
	const ended = (raw: string) => ({ raw: raw.replace(/\n?$/, '\n') });
	const touching =
		line > 0 &&
		!isBlankText(lineRest(out, pastMarkers(out, line))) &&
		!isBlankText(out.slice(pastMarkers(out, above), line));
	const apart =
		touching &&
		(!pair ||
			(!isBlankText(pair.lower) &&
				doc.host.parts(
					doc.tree,
					pair.path,
					pair.index,
					ended(pair.upper),
					ended(pair.lower),
					pair.placed
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

/** Whether `c` is the block at `parent` or a block around it. */
const holding = (parent: readonly number[]) => (c: LaidBlock) =>
	c.path.length <= parent.length && c.path.every((p, i) => p === parent[i]);

/** Where the children of `holder` end: at its closing line, its own end, or the document's. */
function bodyEnd(doc: Doc, holder: LaidBlock | undefined): number {
	if (!holder) return doc.source.length;
	const lines = holder.lines ?? [];
	const fenced = factsOf(doc, holder).lines === 'fenced' && lines.length > 1;
	return fenced && lines.at(-1)!.own ? lines.at(-1)!.from : holder.to;
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

/** Whether the pasted list `block` joins the list `beside` it as items once nothing parts the two,
 *  `under` where the pasted one is the lower: one bullet character, or one ordered delimiter. */
export function joinsList(
	doc: Doc,
	beside: LaidBlock | undefined,
	block: NodeView | undefined,
	under: boolean
): boolean {
	if (!beside || beside.type !== block?.kind || factsOf(doc, beside).lines !== 'items')
		return false;
	const lists = [nodeAt(doc, beside.path), block];
	const [upper, lower] = under ? lists : lists.reverse();
	return itemsShareList(upper.children?.at(-1), lower.children?.[0]);
}

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
	const placed = (block: NodeView, beside: LaidBlock | undefined, under: boolean) =>
		!(lines === 'items' && block.kind === holder!.type) &&
		(always || !joinsList(doc, beside, block, under));
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
			placed: placed(blocks.at(-1)!, lower, false)
		};
		out = parted(doc, out, under, edit.under, always && pair.placed ? null : pair);
	} else if (always && under > 0 && !closes(doc, edit.follows ? place : next)) {
		// What follows the holder's last child is no child of it, yet a last pasted paragraph would
		// read it as its own next line: a blank line keeps it out.
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
		placed: placed(blocks[0], upper, true)
	};
	const grown = parted(doc, out, edit.line, edit.marks, always && pair.placed ? null : pair);
	return { source: grown, caret: edit.caret + grown.length - out.length };
}

/** Whether `byte` sits on the line that closes a container. */
function closes(doc: Doc, byte: number): boolean {
	const closing = (c: LaidBlock) => {
		const last = c.lines?.at(-1);
		return !!last && c.lines!.length > 1 && last.own && last.from <= byte && byte < last.to;
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
	const overRest = (edit: Edit) => (lastJoins ? edit : restApart(doc, edit, leaf, to, cut, last));
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
		const opening = (isBlankText(before) ? eol : eol + blank + eol) + prefix + lines(clip);
		const closing = cut.follows && !lastJoins ? eol + prefix : '';
		const caret = head.length + opening.length + cut.caret;
		return overRest({ source: head + opening + closing + cut.rest, caret });
	}
	// With nothing before the cut the pasted blocks go before the block's second half, which keeps
	// a line of its own, save a paragraph's text the last pasted block takes.
	const body = joined ? clip : clip.replace(/\n$/, '');
	const opening = lines(body);
	// An empty line that text follows right after stays, keeping the pasted blocks apart from it;
	// a line the paste took the text of was never empty.
	const under = Math.min(lineEnd(source, to) + 1, source.length);
	const next = lineRest(source, pastMarkers(source, under));
	const kept = at === to && !cut.follows && !isBlankText(next) ? eol + blank : '';
	const apart = eol + (body !== clip ? blank + eol : '') + prefix;
	const taken = joined || (factsOf(doc, leaf).joins === 'text' && lastJoins && body === clip);
	const closing = cut.follows ? (taken ? '' : apart) : kept;
	const caret = head.length + opening.length + cut.caret;
	return overRest({ source: head + opening + closing + cut.rest, caret });
}
