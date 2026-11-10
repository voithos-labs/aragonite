/**
 * Pasted blocks that land as blocks of their own: the block at the caret splits there and the
 * pasted blocks go between its halves, or the caret's list does, where a pasted list leaves it.
 * A range `[at, to)` inside the block's text goes with the split. At a caret in no block's text
 * they go between the blocks there, a blank line either side only where two would read as one.
 */

import { isBlankText } from '../core/lines';
import type { LaidBlock } from './layout';
import { pastMarkers } from './apart';
import {
	containersHolding,
	contentEnd,
	factsOf,
	findWithin,
	lineOf,
	nodeAt,
	parentOf,
	readDoc,
	titleOwner,
	type Doc
} from './document';
import { numberedAfterSplit } from './list-numbers';
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
	// At the item's first text byte the whole item is the second half.
	const whole = at === leaf.text!.from && leaf.path.at(-1) === 0;
	const head = whole
		? source.slice(0, first.from) + pasted
		: source.slice(0, at) + eol + outer + pasted;
	const tail = !whole && !isBlankText(source.slice(to, contentEnd(doc, item)));
	const marker =
		whole || tail ? eol + outer + source.slice(first.from, whole ? at : first.markerTo) : '';
	const copyAt = tail ? head.length + eol.length + outer.length : null;
	const out = head + marker + source.slice(to);
	const numbered = whole ? out : numberedAfterSplit(doc, list, item.path.at(-1)!, to, out, copyAt);
	const under = lineEnd(numbered, head.length) + 1;
	const lower = numbered.slice(under + outer.length, lineEnd(numbered, under));
	const [path, index] = [list.path.slice(0, -1), list.path.at(-1)!];
	const pair = { path, index, upper: last, lower, placed: true };
	return { source: parted(doc, numbered, under, outer, pair), caret: head.length };
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
 *  when the two would read as one block without it. */
function parted(doc: Doc, out: string, line: number, marks: string, pair: Touching): string {
	const above = out.lastIndexOf('\n', line - 2) + 1;
	const ended = (raw: string) => ({ raw: raw.replace(/\n?$/, '\n') });
	const apart =
		line > 0 &&
		!isBlankText(pair.lower) &&
		!isBlankText(out.slice(pastMarkers(out, above), line)) &&
		doc.host.parts(
			doc.tree,
			pair.path,
			pair.index,
			ended(pair.upper),
			ended(pair.lower),
			pair.placed
		);
	return apart ? out.slice(0, line) + marks.trimEnd() + doc.ending + out.slice(line) : out;
}

/** Whether a container is around the place `at`: it starts before it, and its marker on the
 *  place's line has ended by it. */
const around = (at: number) => (c: LaidBlock) => c.from < at && lineOf(c, at).markerTo <= at;

/** How the nearest container around the place `at` lays out its lines; `'none'` for the document. */
function linesAround(doc: Doc, at: number) {
	const holder = containersHolding(doc, at).findLast(around(at));
	return holder ? factsOf(doc, holder).lines : 'none';
}

/** The clipboard as blocks of its own at `at`, a place in no block's text: what follows `at` on
 *  its line starts the line under them. Null among a table's rows, where no block can stand. */
export function pasteApart(doc: Doc, at: number, clip: string): Edit | null {
	const { source } = doc;
	const outside = around(at);
	if (linesAround(doc, at) === 'rows') return null;
	// The line break that sets what follows on its own line stands for the clipboard's last one.
	const follows = !isBlankText(clip) && !isBlankText(lineRest(source, at));
	const pasted = spliced(doc, at, at, outside)(follows ? clip.replace(/\n$/, '') : clip);
	const moved = follows ? doc.ending + continuation(doc, at, outside) : '';
	const edit = {
		source: source.slice(0, at) + pasted + moved + source.slice(at),
		caret: at + pasted.length
	};
	return setApart(doc, edit, at, clip, true);
}

/** `edit`, which put `clip` on the empty line at `at` that no block holds: its last block stays
 *  apart from the block under it. */
export const apartBelow = (doc: Doc, edit: Edit, at: number, clip: string) =>
	setApart(doc, edit, at, clip, false);

/** `edit` with a blank line between the last block of `clip`, which it put at `at`, and the block
 *  under it where the two would read as one; with `above`, over its first block the same way. */
function setApart(doc: Doc, edit: Edit, at: number, clip: string, above: boolean): Edit {
	const blocks = readDoc(clip, doc.host, doc.mode).tree.children.filter((b) => !isBlankText(b.raw));
	if (blocks.length === 0) return edit;
	const { source } = doc;
	const outside = around(at);
	const lines = linesAround(doc, at);
	if (lines === 'rows') return edit;
	// The blocks either side are children of the nearest container around the place; between a
	// list's items a pasted list is the list's own, which nothing keeps from folding into it.
	const holder = containersHolding(doc, at).findLast(outside);
	const path = holder?.path ?? [];
	const placed = (kind: string) => !(lines === 'items' && kind === holder!.type);
	const child = (b: LaidBlock) =>
		b.path.length === path.length + 1 && path.every((p, i) => p === b.path[i]);
	const head = lineHead(source, at);
	const next = pastMarkers(source, Math.min(lineEnd(source, at) + 1, source.length));
	const lower = findWithin(doc, at, next, (b) => child(b) && b.from >= at);
	let out = edit.source;
	if (lower) {
		const line = out.lastIndexOf('\n', lower.from + out.length - source.length - 1) + 1;
		const pair = {
			path,
			index: lower.path.at(-1)!,
			upper: blocks.at(-1)!.raw,
			lower: nodeAt(doc, lower.path).raw,
			placed: placed(blocks.at(-1)!.kind)
		};
		out = parted(doc, out, line, continuation(doc, at, outside), pair);
	}
	// Past where its line's text starts, the place is on a line of the block above, never under it.
	const under = at === (holder ? lineOf(holder, at).markerTo : at - head.length);
	const reach = above && under ? [...doc.layout.within(at - head.length, at)] : [];
	// A title row is its container's own line, never a block to stay apart from.
	const upper = reach.findLast((b) => child(b) && b.to <= at && !titleOwner(doc, b));
	if (!upper) return { source: out, caret: edit.caret };
	const pair = {
		path,
		index: upper.path.at(-1)!,
		upper: nodeAt(doc, upper.path).raw,
		lower: blocks[0].raw,
		placed: placed(blocks[0].kind)
	};
	const grown = parted(doc, out, at - head.length, head, pair);
	return { source: grown, caret: edit.caret + grown.length - out.length };
}

/** The block at the caret split there, the pasted blocks between its halves; `lastJoins`: the
 *  last of them takes the text after the caret. */
export function splitAt(
	doc: Doc,
	leaf: LaidBlock,
	at: number,
	to: number,
	clip: string,
	lastJoins: boolean
): Edit {
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
		// clipboard as written; the tail joins the last block where that takes joined text.
		const parted = !isBlankText(before) || marked;
		const opening = (parted ? eol + blank + eol : eol) + prefix + lines(clip);
		const caret = at + opening.length;
		const closing = tail && !lastJoins ? eol + prefix + (joinsBefore ? '' : own) : '';
		return { source: source.slice(0, at) + opening + closing + source.slice(to), caret };
	}
	const body = clip.replace(/\n$/, '');
	// With nothing before the caret the pasted blocks go before its block, which keeps its line,
	// save a paragraph's text the last pasted block takes.
	const from = joinsBefore ? at : leaf.from;
	const opening = lines(body);
	const caret = from + opening.length;
	// An empty line that text follows right after stays, keeping the pasted blocks apart from it;
	// a line the paste took the text of was never empty.
	const under = lineEnd(source, to) + 1;
	const next = source.slice(under, lineEnd(source, under));
	const kept = at === to && !tail && next.replace(/^[\s>]*/, '') !== '' ? eol + blank : '';
	const apart = eol + (body !== clip ? blank + eol : '') + prefix + (joinsBefore ? '' : own);
	const taken = joinsBefore && lastJoins && body === clip;
	const closing = tail ? (taken ? '' : apart) : kept;
	return { source: source.slice(0, from) + opening + closing + source.slice(to), caret };
}
