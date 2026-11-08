/**
 * What a removal over a range leaves: the start's line keeps every byte before the range and the
 * end's line every byte after it, and the containers around them stay readable.
 */

import { isBlankText } from '../core/lines';
import type { LaidBlock } from './layout';
import {
	containersAt,
	contentEnd,
	findWithin,
	endingOf,
	factsOf,
	leafAt,
	lineOf,
	nodeAt,
	titleAt,
	titleOwner,
	titleRowOf,
	type Doc
} from './document';
import { heldAt, heldWhole, removalRange } from './removal-range';
import {
	byteAt,
	lineEnd,
	lineEndBefore,
	lineHead,
	lineRest,
	lineTextStart,
	writeLeaf,
	type Edit
} from './leaf-splice';

/** A removal's new bytes; `gone` when the blocks at its start went whole and no text stayed there,
 *  where Backspace's caret goes to the block before (spec § 5.3). */
export interface Removal extends Edit {
	gone?: boolean;
}

export function removeRange(doc: Doc, start: number, end: number): Removal {
	const { from, to } = removalRange(doc, start, end);
	if (from === to) return { source: doc.source, caret: from };
	const head = leafAt(doc, from);
	const tail = leafAt(doc, to);
	const held = heldAt(doc, from, to);
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
	return across(doc, from, to, held ?? head?.leaf, held !== undefined);
}

/** A range across blocks: the end's tail joins the start where the start takes joined text, and
 *  stays a line of its own where it doesn't (a title row, a code block, a block the range enters). */
function across(
	doc: Doc,
	from: number,
	to: number,
	first: LaidBlock | undefined,
	held: boolean
): Removal {
	const { source } = doc;
	// A start block held whole goes, so the tail takes its place; an end block that takes no joined
	// text (a code block) and that the range only reaches stays a block.
	const end = leafAt(doc, to);
	const last = end?.leaf;
	const opening = enteredOpening(doc, from, to);
	const takes = (b: LaidBlock) => !titleOwner(doc, b) && factsOf(doc, b).joins !== 'never';
	const ends = !last || last === first || takes(last) || to > last.from;
	const joins = opening === null && (held || (first !== undefined && takes(first))) && ends;
	let tail = source.slice(to);
	// Blocks taken whole from a line's start go with their lines, unless the last ending is the
	// document's; a line keeping markers before them keeps its ending too, so nothing joins them.
	const ending = /^\r?\n/.exec(tail)?.[0] ?? '';
	const withLine = held && lineHead(source, from) === '' && endsHoldingWhole(doc, from, to);
	if (withLine && ending && to + ending.length < source.length) {
		tail = tail.slice(ending.length);
		// Where blank lines stand on both sides, one goes too, so no empty paragraph is left behind.
		const blank = /^[ \t]*\r?\n/.exec(tail)?.[0];
		if (blank && /(^|\n)[ \t]*\r?\n$/.test(source.slice(0, from))) tail = tail.slice(blank.length);
	}
	if (!joins) {
		const lineStart = source.lastIndexOf('\n', to - 1) + 1;
		const textStart = end ? lineTextStart(doc, end.leaf, end.offset) : to;
		const markers =
			opening ??
			(lineStart > from && textStart >= lineStart ? source.slice(lineStart, textStart) : '');
		tail = endingOf(source) + markers + tail;
	}
	const joined = source.slice(0, from) + rowTail(doc, from, to) + tail;
	const kept = closers(doc, from, to);
	const at = lineEndBefore(joined, from);
	const closed = kept ? joined.slice(0, at) + kept + joined.slice(at) : joined;
	const gone = held && (withLine || !joins || isBlankText(lineRest(tail, 0)));
	return {
		source: joins ? movedMarkers(doc, from, to, closed) : closed,
		caret: from,
		...(gone && { gone })
	};
}

/** The opening of a fenced block the range enters from outside, kept with the blank lines and
 *  markers before it so no closing line is left alone; null where it enters none. */
function enteredOpening(doc: Doc, from: number, to: number): string | null {
	const entered =
		containersAt(doc, to, 'end').find(
			(c) => factsOf(doc, c).lines === 'fenced' && c.from > from && c.lines!.at(-1)!.from >= to
		) ??
		findWithin(doc, from, to, (b) => {
			if (!b.text || b.from <= from || to <= b.from) return false;
			const closer = doc.host.fence(nodeAt(doc, b.path).raw)?.closer;
			return closer !== null && closer !== undefined && to <= byteAt(doc, b, closer);
		});
	const end = leafAt(doc, to);
	if (!entered || !end) return null;
	const { source } = doc;
	const textStart = lineTextStart(doc, end.leaf, end.offset);
	const endLine = source.lastIndexOf('\n', textStart - 1) + 1;
	const opened = Math.min(openingEnd(doc, entered), endLine);
	const outer =
		containersAt(doc, entered.from, 'start').find((c) => c.from > from && c !== entered) ?? entered;
	const first = Math.max(from, source.lastIndexOf('\n', entered.from - 1) + 1);
	return (
		source.slice(Math.max(from, outer.start), Math.max(from, outer.from)) +
		source.slice(first, Math.max(first, opened)) +
		source.slice(Math.max(opened, endLine), textStart)
	);
}

/** Where a fenced block's opening ends: a fence's at its body, a container's past its opening lines
 *  and its title row. */
function openingEnd(doc: Doc, block: LaidBlock): number {
	if (!block.container) {
		const body = doc.host.fence(nodeAt(doc, block.path).raw)?.body;
		return body === undefined ? block.from : byteAt(doc, block, body);
	}
	let at = block.from;
	for (const line of block.lines!) {
		if (!line.own) break;
		at = line.to;
	}
	return Math.max(at, titleRowOf(doc, block)?.to ?? at);
}

/** Whether the range ends at the end of a block other than a paragraph that it takes from that
 *  block's first byte. */
const endsHoldingWhole = (doc: Doc, from: number, to: number) =>
	findWithin(doc, from, to, (b) => b.from >= from && heldWhole(doc, b, b.from, to)) !== undefined;

/** A title row the range starts in and leaves keeps its line past its text: a summary's closing
 *  tag, so the row stays a title row. */
function rowTail(doc: Doc, from: number, to: number): string {
	const row = titleAt(doc, from);
	if (!row || from > row.text!.to) return '';
	const lineTo = lineEnd(doc.source, row.text!.to);
	if (to <= lineTo) return '';
	return doc.source.slice(row.text!.to, lineTo).replace(/\r$/, '');
}

/** The closing lines the range starts inside and leaves, innermost first: a fenced block's, the
 *  way its own write rule closes it, then each fenced container's. They stay after the joined text. */
function closers(doc: Doc, from: number, to: number): string {
	let out = '';
	const start = leafAt(doc, from)?.leaf;
	const fence = start && !titleOwner(doc, start) && doc.host.fence(nodeAt(doc, start.path).raw);
	if (start && fence && fence.closer !== null && to > contentEnd(doc, start)) {
		const closer = byteAt(doc, start, fence.closer);
		// From the line ending before the closing line, so that line keeps its own ending.
		const before = doc.source.lastIndexOf('\n', closer - 1);
		const at = doc.source[before - 1] === '\r' ? before - 1 : before;
		if (from >= byteAt(doc, start, fence.body)) out += doc.source.slice(at, contentEnd(doc, start));
	}
	for (const c of containersAt(doc, from, 'start').reverse()) {
		if (factsOf(doc, c).lines !== 'fenced' || c.from >= from) continue;
		const last = c.lines!.at(-1)!;
		if (!last.own || last.from >= to) continue;
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
	for (const c of doc.layout.within(from, to)) {
		const moves = c.container && factsOf(doc, c).lines === 'first-line';
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
