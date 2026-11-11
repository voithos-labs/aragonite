/**
 * Pasted blocks that land as blocks of their own: the block at the caret splits there and the
 * pasted blocks go between its halves, or the caret's list does, where a pasted list leaves it.
 * A range `[at, to)` inside the block's text goes with the split. At a place between blocks they
 * stand a blank line apart from the block either side; at a text caret in no block's text, only
 * where two would read as one.
 */

import { isBlankText } from '../core/lines';
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
import { lineEnd, lineHead, lineRest, spliced, type Edit } from './leaf-splice';

/** A pasted list of another kind than `list`, the caret's: the pasted blocks land between the
 *  list's halves, and what the caret's item holds after the caret is the second half's first item. */
export function splitOut(
	doc: Doc,
	list: LaidBlock,
	leaf: LaidBlock,
	at: number,
	to: number,
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
	// At the item's first text byte the whole item is the second half; with no text after the range
	// either it has none to be an item of, and gives way to the items under it.
	const whole = at === leaf.text!.from && leaf.path.at(-1) === 0;
	const rest = !isBlankText(source.slice(to, contentEnd(doc, item)));
	const head = whole
		? source.slice(0, first.from) + pasted
		: source.slice(0, at) + eol + outer + pasted;
	const tail = !whole && rest;
	const marker = rest ? eol + outer + source.slice(first.from, whole ? at : first.markerTo) : '';
	const copyAt = tail ? head.length + eol.length + outer.length : null;
	const out = head + marker + source.slice(to);
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

/** `edit` left `last`, a pasted block that takes no text, over what `leaf` holds from `to` on, or
 *  over the block flush under it: a blank line between the two where they would read as one. */
export function restApart(
	doc: Doc,
	edit: Edit,
	leaf: LaidBlock,
	to: number,
	last: string,
	marker = ''
): Edit {
	const shift = edit.source.length - doc.source.length;
	const tail = !isBlankText(lineRest(doc.source, to));
	const rest = nodeAt(doc, leaf.path).raw.slice(doc.layout.pointAt(to)!.offset);
	// What the leaf still holds stands behind the marker it kept (a heading's).
	const held = marker + (tail ? rest : rest.replace(/^\r?\n/, ''));
	const [path, index] = [leaf.path.slice(0, -1), leaf.path.at(-1)!];
	const next = isBlankText(held) ? doc.layout.block([...path, index + 1]) : undefined;
	const flush = next && next.from <= pastMarkers(doc.source, leaf.to);
	const line = flush
		? leaf.to + shift
		: tail
			? edit.source.lastIndexOf('\n', to + shift - 1) + 1
			: lineEnd(edit.source, to + shift) + 1;
	const lower = flush ? nodeAt(doc, next.path).raw : held;
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

/** `clip` on the empty line at `at` that no block holds: its last block stays apart from the
 *  block under it. */
export function apartBelow(doc: Doc, at: number, clip: string): Edit {
	const holder = holderAt(doc, at);
	return setApart(doc, setIn(doc, at, holder, clip), holder, clip, false, false);
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
	// Between a list's items a pasted list is the list's own, which nothing keeps from folding into it.
	const path = holder?.path ?? [];
	const placed = (kind: string) => !(lines === 'items' && kind === holder!.type);
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
			placed: placed(blocks.at(-1)!.kind)
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
		placed: placed(blocks[0].kind)
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

/** The block at the caret split there, the pasted blocks between its halves; `lastJoins`: the
 *  last of them, `last`, takes the text after the caret. */
export function splitAt(
	doc: Doc,
	leaf: LaidBlock,
	at: number,
	to: number,
	clip: string,
	lastJoins: boolean,
	last: string
): Edit {
	const overRest = (edit: Edit, marker = '') =>
		lastJoins ? edit : restApart(doc, edit, leaf, to, last, marker);
	const { source } = doc;
	const eol = doc.ending;
	const prefix = continuation(doc, at);
	const blank = prefix.trimEnd();
	const text = leaf.text!;
	const lineStart = source.lastIndexOf('\n', at - 1) + 1;
	// A heading's own marker, which a tail of its own takes again.
	const own = leaf.from >= lineStart ? source.slice(leaf.from, text.from) : '';
	const joinsBefore = factsOf(doc, leaf).joins === 'text';
	const before = source.slice(text.from, at);
	const tail = !isBlankText(lineRest(source, to));
	const lines = spliced(doc, at, to);
	// A heading emptied of its text keeps its marker, which stands before the caret as text would.
	const marked = !joinsBefore && !tail;
	if (before !== '' || marked) {
		// The head keeps its line, a blank line under it (a head of blanks is one already), then the
		// clipboard as written; the tail joins the last block that takes joined text, else is a paragraph.
		const parted = !isBlankText(before) || marked;
		const opening = (parted ? eol + blank + eol : eol) + prefix + lines(clip);
		const caret = at + opening.length;
		const closing = tail && !lastJoins ? eol + prefix : '';
		return overRest({ source: source.slice(0, at) + opening + closing + source.slice(to), caret });
	}
	const body = clip.replace(/\n$/, '');
	// With nothing before the caret the pasted blocks go before its block, which keeps its line,
	// save a paragraph's text the last pasted block takes.
	const from = joinsBefore ? at : leaf.from;
	const opening = lines(body);
	const caret = from + opening.length;
	// An empty line that text follows right after stays, keeping the pasted blocks apart from it;
	// a line the paste took the text of was never empty.
	const under = Math.min(lineEnd(source, to) + 1, source.length);
	const next = lineRest(source, pastMarkers(source, under));
	const kept = at === to && !tail && !isBlankText(next) ? eol + blank : '';
	const marker = joinsBefore ? '' : own;
	const apart = eol + (body !== clip ? blank + eol : '') + prefix + marker;
	const taken = joinsBefore && lastJoins && body === clip;
	const closing = tail ? (taken ? '' : apart) : kept;
	const out = source.slice(0, from) + opening + closing + source.slice(to);
	return overRest({ source: out, caret }, marker);
}
