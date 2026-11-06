/**
 * What a removal over a range leaves: the start's line keeps every byte before the range and the
 * end's line every byte after it, and the containers around them stay readable.
 */

import { isBlankText } from '../core/lines';
import type { LaidBlock } from './layout';
import {
	containersAt,
	contentEnd,
	endingOf,
	factsOf,
	leafAt,
	lineOf,
	nodeAt,
	titleOwner,
	type Doc
} from './document';
import { heldWhole, removalRange } from './removal-range';
import { byteAt, lineEnd, lineRest, lineTextStart, writeLeaf, type Edit } from './leaf-splice';

export function removeRange(doc: Doc, start: number, end: number): Edit {
	const { from, to } = removalRange(doc, start, end);
	if (from === to) return { source: doc.source, caret: from };
	const head = leafAt(doc, from);
	const tail = leafAt(doc, to);
	const held = doc.layout.blocks.find((b) => heldWhole(doc, b, from, to));
	if (head && tail && head.leaf === tail.leaf && !held) {
		const { leaf } = head;
		const write = doc.host.leaf.replace(
			doc.tree,
			leaf.path,
			head.offset,
			tail.offset,
			'',
			doc.mode
		);
		return writeLeaf(doc, leaf, write, head.offset, tail.offset);
	}
	return entering(doc, from, to) ?? across(doc, from, to, held ?? head?.leaf, held !== undefined);
}

/** A range from outside into the body of a block with an opening line, a container's or a fence's:
 *  the opening stays, so no closing line is left alone, and only the text at either end goes. */
function entering(doc: Doc, from: number, to: number): Edit | null {
	const entered =
		containersAt(doc, to, 'end').find(
			(c) => factsOf(doc, c).lines === 'fenced' && c.from > from && c.lines!.at(-1)!.from >= to
		) ??
		doc.layout.blocks.find((b) => {
			if (!b.text || b.from <= from || to <= b.from) return false;
			const closer = doc.host.fence(nodeAt(doc, b.path).raw)?.closer;
			return closer !== null && closer !== undefined && to <= byteAt(doc, b, closer);
		});
	const end = leafAt(doc, to);
	if (!entered || !end) return null;
	const { source } = doc;
	const startEnd = Math.min(lineEnd(source, from), entered.from);
	const kept = source.slice(startEnd, Math.max(startEnd, lineTextStart(doc, end.leaf, end.offset)));
	return { source: source.slice(0, from) + kept + source.slice(to), caret: from };
}

/** A range across blocks: the end's tail joins the start where the start takes joined text, and
 *  stays a line of its own where it doesn't (a title row, a code block). */
function across(
	doc: Doc,
	from: number,
	to: number,
	first: LaidBlock | undefined,
	held: boolean
): Edit {
	const { source } = doc;
	// A start block held whole goes, so the tail takes its place; an end block that takes no joined
	// text (a code block) and that the range only reaches stays a block.
	const end = leafAt(doc, to);
	const last = end?.leaf;
	const takes = (b: LaidBlock) => !titleOwner(doc, b) && factsOf(doc, b).joins !== 'never';
	const ends = !last || last === first || takes(last) || to > last.from;
	const joins = (held || (first !== undefined && takes(first))) && ends;
	let tail = source.slice(to);
	// A block held whole goes with its line, unless that line ending is the document's last.
	const ending = /^\r?\n/.exec(tail)?.[0] ?? '';
	const alone = held && first !== undefined && to === contentEnd(doc, first);
	if (alone && ending && to + ending.length < source.length) tail = tail.slice(ending.length);
	if (!joins) {
		const lineStart = source.lastIndexOf('\n', to - 1) + 1;
		const textStart = end ? lineTextStart(doc, end.leaf, end.offset) : to;
		const markers =
			lineStart > from && textStart >= lineStart ? source.slice(lineStart, textStart) : '';
		tail = endingOf(source) + markers + tail;
	}
	const joined = source.slice(0, from) + tail;
	const kept = closers(doc, from, to);
	const at = lineEnd(joined, from);
	const closed = kept ? joined.slice(0, at) + kept + joined.slice(at) : joined;
	return { source: joins ? movedMarkers(doc, from, to, closed) : closed, caret: from };
}

/** The closing lines of the containers the range starts inside and leaves, innermost first: they
 *  stay after the joined text. */
function closers(doc: Doc, from: number, to: number): string {
	let out = '';
	for (const c of containersAt(doc, from, 'start').reverse()) {
		const last = c.lines!.at(-1)!;
		if (factsOf(doc, c).lines !== 'fenced' || !last.own || last.from >= to || c.from >= from)
			continue;
		const lineStart = doc.source.lastIndexOf('\n', last.from - 1) + 1;
		out += endingOf(doc.source) + doc.source.slice(lineStart, last.to).replace(/\r?\n$/, '');
	}
	return out;
}

/** A container whose first-line marker rode on a line the range took keeps it on the line that now
 *  starts it. `out` is the source after the removal, every change before that line. */
function movedMarkers(doc: Doc, from: number, to: number, out: string): string {
	const end = leafAt(doc, to)?.leaf;
	if (!end) return out;
	const shift = out.length - doc.source.length;
	let result = out;
	for (const c of doc.layout.blocks) {
		const moves = c.lines && factsOf(doc, c).lines === 'first-line';
		if (!moves || c.from < from || c.from >= to || c.to <= to) continue;
		if (end.path.slice(0, c.path.length).join() !== c.path.join()) continue;
		const firstLine = c.lines!.find((l) => !l.own)!;
		const next = c.lines!.find(
			(l) => l.from >= to && !isBlankText(lineRest(doc.source, l.markerTo))
		);
		if (!next || next === lineOf(c, to)) continue;
		const marker = doc.source.slice(firstLine.from, firstLine.markerTo);
		const at = next.from + shift + (result.length - out.length);
		result = result.slice(0, at) + marker + result.slice(at + next.markerTo - next.from);
	}
	return result;
}
