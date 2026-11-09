/**
 * What a removal over a range leaves: the start's line keeps every byte before the range and the
 * end's line every byte after it, and the containers around them stay readable.
 */

import {
	endsInBlankLine,
	isBlankText,
	ownTrailingLineEnding,
	trimTrailingLineEnding
} from '../core/lines';
import { getContentRange } from '../core/inline';
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
	parentOf,
	titleOwner,
	titleRowOf,
	type Doc
} from './document';
import type { JoinSide } from './host';
import { heldAt, heldWhole, removalRange } from './removal-range';
import {
	byteAt,
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
	const last = held && doc.wholeBlocks ? endingItsParent(doc, held, to) : null;
	if (last) return last;
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

/** A block removed whole as the last of its parent goes with the line break and blank lines before
 *  it, so the block above ends as it did, open or closed; a blank last line above keeps its break. */
function endingItsParent(doc: Doc, block: LaidBlock, to: number): Removal | null {
	const index = block.path.at(-1)!;
	const sibling = (i: number) => doc.layout.block([...block.path.slice(0, -1), i]);
	const prev = index > 0 ? sibling(index - 1) : undefined;
	if (!prev || sibling(index + 1) || to < contentEnd(doc, block)) return null;
	let leaf = nodeAt(doc, prev.path);
	while (leaf.children?.length) leaf = leaf.children.at(-1)!;
	// A blank last line above keeps its break, so the block's own line ending goes with the block.
	const blankAbove = endsInBlankLine(leaf.raw);
	const at = blankAbove ? prev.to : contentEnd(doc, prev);
	const end = blankAbove ? block.to : contentEnd(doc, block);
	// The parent now ends on the block above's line, against whatever follows the parent.
	const ending = /^\r?\n/.exec(doc.source.slice(end, end + 2))?.[0].length ?? 0;
	const below = ending > 0 ? deepestAt(doc, pastMarkers(doc.source, end + ending)) : undefined;
	const seam = { from: at, to: end, upper: prev, lower: below, rewritten: {} };
	const source = apartAt(
		doc,
		doc.source.slice(0, at) + doc.source.slice(end),
		at + ending,
		seam,
		false
	);
	return { source, caret: at, gone: true };
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
	// What follows never takes the place of a block whose parent would read it as its own (a row).
	const parent = held && first ? parentOf(doc, first) : undefined;
	const takesPlace = held && !(parent && factsOf(doc, parent).lines === 'rows');
	const joins = opening === null && (takesPlace || (first !== undefined && takes(first))) && ends;
	const head = held ? null : leafAt(doc, from);
	if (joins && head && end && head.leaf !== end.leaf) return joinedLeaves(doc, from, to, head, end);
	const lines = held ? wholeLines(doc, from, to) : null;
	let tail = lines?.tail ?? source.slice(to);
	// Where no text joins it, each end the range leaves is cut through its own block's write (spec
	// § 5.11); a range ending in the start block's own trailing syntax splices the bytes alone.
	const leaves = head !== null && to >= contentEnd(doc, head.leaf);
	const start = leaves ? cutLeaf(doc, head.leaf, head.offset, 'after') : null;
	const lineStart = source.lastIndexOf('\n', to - 1) + 1;
	const cut =
		!joins && end && !lines && lineStart > from
			? cutLeaf(doc, end.leaf, end.offset, 'before')
			: null;
	if (!joins) {
		const kept = opening?.kept ?? '';
		if (cut) tail = kept + cut.source.slice(lineStart);
		else {
			const textStart = end ? lineTextStart(doc, end.leaf, end.offset) : to;
			const markers =
				lineStart > from && textStart >= lineStart ? source.slice(lineStart, textStart) : '';
			tail = (opening ? kept + source.slice(opening.endLine, textStart) : markers) + tail;
		}
		// An end block the range takes whole (a rule) goes with its line, markers included; an emptied
		// paragraph keeps its line, and nothing left after the range needs one.
		const goes =
			!lines &&
			kept === '' &&
			!!end &&
			end.leaf.from > from &&
			heldWhole(doc, end.leaf, end.leaf.from, to);
		if (goes) tail = tail.replace(/^[ \t>]*(?=\r?\n|$)/, '');
		else if (tail !== '') tail = endingOf(source) + tail;
	}
	const before =
		lines?.before ?? (start ? start.source.slice(0, start.end) : source.slice(0, from));
	const joined = before + tail;
	const closerAt = lineEndBefore(joined, before.length);
	const closed = withClosers(doc, from, to, joined, closerAt);
	// The tail's line: the one `before` ends on behind its markers, or the next where the tail
	// opens with a line ending.
	const opens = /^\r?\n/.exec(tail)?.[0].length ?? 0;
	const lowerLine = joined.lastIndexOf('\n', before.length + opens - 1) + 1;
	const at = lowerLine > closerAt ? lowerLine + closed.length - joined.length : lowerLine;
	// Where blocks go whole from the start, the block on the line above it, else the start's own.
	const upper = held
		? deepestAt(doc, from - lineHead(source, from).length - 1)
		: (head?.leaf ?? deepestAt(doc, from - 1));
	const lower = lines
		? deepestAt(doc, source.length - lines.tail.length)
		: (end?.leaf ?? deepestAt(doc, to));
	// Where the tail takes a held block's place, the end block keeps only what follows the range.
	const rest = joins && end && !lines ? nodeAt(doc, end.leaf.path).raw.slice(end.offset) : null;
	const rewritten = {
		...(head && start && { upper: { block: head.leaf, raw: start.raw, kind: head.leaf.type } }),
		...(end && cut && { lower: { block: end.leaf, raw: cut.raw, kind: end.leaf.type } }),
		...(end && rest !== null && { lower: { block: end.leaf, raw: rest } })
	};
	const parted = apartAt(doc, closed, at, { from, to, upper, lower, rewritten }, !joins);
	const gone = held && (!!lines || !joins || isBlankText(lineRest(tail, 0)));
	return {
		source: joins ? movedMarkers(doc, from, to, parted, to) : parted,
		caret: lines?.caret ?? start?.caret ?? from,
		...(gone && { gone })
	};
}

/** A text block cut through its own write, the text `after` the offset or `before` it on its line,
 *  so a run the cut leaves open closes. Null for a fenced block, whose closer `closers` keeps. */
function cutLeaf(doc: Doc, leaf: LaidBlock, at: number, side: 'after' | 'before') {
	const node = nodeAt(doc, leaf.path);
	if (doc.host.fence(node.raw)) return null;
	const text = getContentRange(node);
	const lineStart = Math.max(node.raw.lastIndexOf('\n', at - 1) + 1, text.start);
	const [cutFrom, cutTo] = side === 'after' ? [at, text.end] : [lineStart, at];
	// Nothing cut, or the whole text: the bytes alone, since a live write of a block's whole text
	// takes its markers too, which lie outside the range.
	if (cutFrom >= cutTo || (cutFrom <= text.start && cutTo >= text.end)) {
		const a = byteAt(doc, leaf, cutFrom);
		const b = Math.max(a, byteAt(doc, leaf, cutTo));
		const source = doc.source.slice(0, a) + doc.source.slice(b);
		const raw = node.raw.slice(0, cutFrom) + node.raw.slice(Math.max(cutFrom, cutTo));
		return { source, caret: a, end: contentEnd(doc, leaf) - (b - a), raw };
	}
	const write = doc.host.leaf.replace(doc.tree, leaf.path, cutFrom, cutTo, '', doc.mode);
	const written = writeLeaf(doc, leaf, write, cutFrom, cutTo);
	const shift = written.source.length - doc.source.length;
	return { ...written, end: contentEnd(doc, leaf) + shift, raw: write.bytes };
}

// ── The join a removal leaves ────────────────────────────────────────────────

/** A block the removal rewrote, with its bytes after the write; a kind it may have lost is read. */
interface Rewritten {
	block: LaidBlock;
	raw: string;
	kind?: string;
}

interface Pair {
	parent: number[];
	index: number;
	upper: JoinSide;
	lower: JoinSide;
}

/** The join a removal over `[from, to)` leaves: the block the upper side ends in and the one the
 *  lower side starts in, read before the removal, and the blocks it rewrote. */
interface Seam {
	from: number;
	to: number;
	upper: LaidBlock | undefined;
	lower: LaidBlock | undefined;
	rewritten: { upper?: Rewritten; lower?: Rewritten };
}

/** The siblings `seam` leaves touching, under the nearest parent holding both sides, `before` the
 *  new bytes up to the lower one; null where a side changed inside a container, behind markers. */
function siblingsAt(doc: Doc, seam: Seam, before: string): Pair | null {
	const { from, to, upper, lower, rewritten } = seam;
	if (!upper || !lower) return null;
	let k = 0;
	while (k < upper.path.length && k < lower.path.length && upper.path[k] === lower.path[k]) k++;
	if (k >= upper.path.length || k >= lower.path.length) return null;
	const side = (block: LaidBlock, written: Rewritten | undefined, untouched: boolean) => {
		if (written && written.block.path.join() === block.path.join()) return written;
		return untouched ? nodeAt(doc, block.path) : null;
	};
	const above = doc.layout.block(upper.path.slice(0, k + 1))!;
	const below = doc.layout.block(lower.path.slice(0, k + 1))!;
	// A top-level block's bytes are its own, so one the removal changed reads off the new bytes.
	const changed = k === 0 && { ...nodeAt(doc, above.path), raw: before.slice(above.from) };
	const up = side(above, rewritten.upper, contentEnd(doc, above) <= from) ?? (changed || null);
	const down = side(below, rewritten.lower, below.from >= to);
	return up && down
		? { parent: upper.path.slice(0, k), index: upper.path[k], upper: up, lower: down }
		: null;
}

/** `out` with a blank line opening at `at`, where the lower block's line starts, when the pair
 *  `seam` leaves touching there would read as something else flush (`RangeHost.parts`). */
function apartAt(doc: Doc, out: string, at: number, seam: Seam, placed: boolean): string {
	if (at === 0) return out;
	const line = lineRest(out, at);
	const lineAbove = out.slice(out.lastIndexOf('\n', at - 2) + 1, at - 1);
	// A blank line parts them already.
	if (/^[ \t>]*$/.test(line) || /^[ \t>]*\r?$/.test(lineAbove)) return out;
	const pair = siblingsAt(doc, seam, out.slice(0, at));
	if (!pair || !doc.host.parts(doc.tree, pair.parent, pair.index, pair.upper, pair.lower, placed))
		return out;
	const marks = /^[ \t>]*/.exec(line)![0].trimEnd();
	return out.slice(0, at) + marks + endingOf(doc.source) + out.slice(at);
}

/** Where the text of the line starting at `at` starts, past its container markers. */
function pastMarkers(source: string, at: number): number {
	const markers = /[ \t>]*/y;
	markers.lastIndex = at;
	markers.exec(source);
	return markers.lastIndex;
}

/** The innermost block whose own bytes hold `byte`. */
function deepestAt(doc: Doc, byte: number): LaidBlock | undefined {
	let found: LaidBlock | undefined;
	for (const block of doc.layout.within(byte, byte))
		if (block.from <= byte && byte < block.to) found = block;
	return found;
}

/** Blocks taken whole go with their line (behind markers, the next line's markers go instead), and
 *  with the blank line after them where one stands before them too (spec § 5.2). Null: it stays. */
function wholeLines(doc: Doc, from: number, to: number) {
	const { source } = doc;
	const marks = lineHead(source, from);
	const holder = containersAt(doc, from, 'start').at(-1);
	// A container holding only the block keeps its line, emptied (C10).
	const shared = holder !== undefined && (nodeAt(doc, holder.path).children?.length ?? 0) > 1;
	if ((marks !== '' && !shared) || !endsHoldingWhole(doc, from, to)) return null;
	const ending = /^\r?\n/.exec(source.slice(to))?.[0];
	const above = source.slice(0, from - marks.length);
	let tail = ending === undefined ? '' : source.slice(to + ending.length);
	// A document emptied whole keeps its last line ending, as the line its one empty block holds.
	if (ending === undefined || (above === '' && tail === '')) return null;
	// At the document's start a blank line after it would read as an empty paragraph.
	const blankAfter = /^[ \t>]*\r?\n/.exec(tail)?.[0];
	if (blankAfter && (above === '' || /(^|\n)[ \t>]*\r?\n$/.test(above)))
		tail = tail.slice(blankAfter.length);
	if (marks !== '' && !tail.startsWith(marks)) return null;
	return { before: source.slice(0, from), tail: tail.slice(marks.length), caret: from };
}

type LeafPoint = NonNullable<ReturnType<typeof leafAt>>;

/** The end block's text joined onto the start block's through the host's join, so the joined line
 *  takes the start block's write rule, keeps its syntax and drops the end block's (spec § 5.2). */
function joinedLeaves(doc: Doc, from: number, to: number, head: LeafPoint, end: LeafPoint) {
	const { source } = doc;
	const write = doc.host.leaf.join(
		doc.tree,
		{ path: head.leaf.path, offset: head.offset },
		{ path: end.leaf.path, offset: end.offset },
		doc.mode
	);
	const raw = nodeAt(doc, head.leaf.path).raw;
	// Up to the block's last line ending, so the line after it keeps its own markers.
	const written = writeLeaf(
		doc,
		head.leaf,
		write,
		head.offset,
		raw.length - ownTrailingLineEnding(raw).length
	);
	const shift = written.source.length - source.length;
	const leafEnd = head.leaf.to + shift;
	const joined = written.source.slice(0, leafEnd) + written.source.slice(end.leaf.to + shift);
	const upper = trimTrailingLineEnding(write.bytes) + ownTrailingLineEnding(raw);
	const parted = apartAt(
		doc,
		joined,
		leafEnd,
		{
			from,
			to,
			upper: head.leaf,
			lower: deepestAt(doc, pastMarkers(source, end.leaf.to)),
			rewritten: { upper: { block: head.leaf, raw: upper, kind: head.leaf.type } }
		},
		false
	);
	const closerAt = leafEnd - ownTrailingLineEnding(write.bytes).length;
	const closed = withClosers(doc, from, to, parted, closerAt);
	return { source: movedMarkers(doc, from, to, closed, end.leaf.to), caret: written.caret };
}

/** `joined` with the closing lines the range starts inside and leaves put back at `at`. */
function withClosers(doc: Doc, from: number, to: number, joined: string, at: number): string {
	const kept = closers(doc, from, to);
	return kept ? joined.slice(0, at) + kept + joined.slice(at) : joined;
}

/** The opening of a fenced block the range enters from outside, kept with the blank lines before
 *  it so no closing line is left alone, and where the end's line starts; null where it enters none. */
function enteredOpening(
	doc: Doc,
	from: number,
	to: number
): { kept: string; endLine: number } | null {
	const entered =
		containersAt(doc, to, 'end').find(
			(c) => opensFenced(doc, c, to) && c.from > from && c.lines!.at(-1)!.from >= to
		) ??
		findWithin(doc, from, to, (b) => {
			if (!b.text || b.from <= from || to <= b.from) return false;
			const closer = doc.host.fence(nodeAt(doc, b.path).raw)?.closer;
			return closer !== null && closer !== undefined && to <= byteAt(doc, b, closer);
		});
	if (!entered) return null;
	const end = leafAt(doc, to);
	const { source } = doc;
	// An end inside the opening's own syntax, before any text, keeps the bytes up to it.
	const textStart = end ? lineTextStart(doc, end.leaf, end.offset) : to;
	const endLine = source.lastIndexOf('\n', textStart - 1) + 1;
	const opened = Math.min(openingEnd(doc, entered), endLine);
	const outer =
		containersAt(doc, entered.from, 'start').find((c) => c.from > from && c !== entered) ?? entered;
	const first = Math.max(from, source.lastIndexOf('\n', entered.from - 1) + 1);
	const kept =
		source.slice(Math.max(from, outer.start), Math.max(from, outer.from)) +
		source.slice(first, Math.max(first, opened));
	return { kept, endLine: Math.max(opened, endLine) };
}

/** A container whose structure opens it, entered past that opening: a fenced container, or a table
 *  the range enters below its delimiter (one ending in its header takes the header's text). */
function opensFenced(doc: Doc, c: LaidBlock, to: number): boolean {
	const { lines } = factsOf(doc, c);
	return lines === 'fenced' || (lines === 'rows' && to >= openingEnd(doc, c));
}

/** Where a fenced block's opening ends: a fence's at its body, a table's past its delimiter line, a
 *  container's past its opening lines and its title row. */
function openingEnd(doc: Doc, block: LaidBlock): number {
	if (!block.container) {
		const body = doc.host.fence(nodeAt(doc, block.path).raw)?.body;
		return body === undefined ? block.from : byteAt(doc, block, body);
	}
	if (factsOf(doc, block).lines === 'rows')
		return block.lines!.find((l) => l.own)?.to ?? block.from;
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
		// A range starting on or past the closing line leaves it standing.
		if (from >= byteAt(doc, start, fence.body) && from <= closer)
			out += doc.source.slice(at, contentEnd(doc, start));
	}
	for (const c of containersAt(doc, from, 'start').reverse()) {
		if (factsOf(doc, c).lines !== 'fenced' || c.from >= from) continue;
		const last = c.lines!.at(-1)!;
		// A range starting on or past the closing line leaves it standing, as the fence's does.
		if (!last.own || last.from >= to || from >= last.from) continue;
		const lineStart = doc.source.lastIndexOf('\n', last.from - 1) + 1;
		out += endingOf(doc.source) + doc.source.slice(lineStart, last.to).replace(/\r?\n$/, '');
	}
	return out;
}

/** A first-line marker whose line the range took moves to the container's next line from `past`
 *  in `out`; a list item's goes instead (`structural-edits.md` § Structural operations). */
function movedMarkers(doc: Doc, from: number, to: number, out: string, past: number): string {
	const end = leafAt(doc, to)?.leaf;
	if (!end) return out;
	const shift = out.length - doc.source.length;
	let result = out;
	for (const c of doc.layout.within(from, to)) {
		const moves = c.container && factsOf(doc, c).lines === 'first-line';
		if (!moves || c.from < from || c.from >= to || c.to <= to) continue;
		if (end.path.slice(0, c.path.length).join() !== c.path.join()) continue;
		const parent = parentOf(doc, c);
		if (parent && factsOf(doc, parent).lines === 'items') continue;
		const firstLine = c.lines!.find((l) => !l.own)!;
		const next = c.lines!.find(
			(l) => l.from >= past && !isBlankText(lineRest(doc.source, l.markerTo))
		);
		if (!next || next === lineOf(c, to)) continue;
		const marker = doc.source.slice(firstLine.from, firstLine.markerTo);
		const at = next.from + shift + (result.length - out.length);
		result = result.slice(0, at) + marker + result.slice(at + next.markerTo - next.from);
	}
	return result;
}
