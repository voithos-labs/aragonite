/**
 * What a document's tree becomes when runs of its bytes change: the top-level blocks each change
 * reaches, read again from the new bytes, so the tree is what opening them gives. A read starts at
 * the last block before the change with text of its own and runs on past it until the next such
 * block still starts where it stood (`docs/design/commit-and-undo.md` § The byte splice).
 */

import type { CstNode } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import {
	unfinishedReadings,
	waitingAboveClosedBy,
	type GrammarView
} from '../schema/block-openers';
import { isBlankParagraph } from '../core/parser';
import { splitLines } from '../core/lines';
import { readAsOpened } from '../schema/opened-reading';
import { sharedPrefixLength, sharedSuffixLength } from '../core/written-span';
import { keepUnchangedDeep } from '../block-id';

/** One run of the current bytes replaced: `[from, to)` gives way to `insert`. */
export interface ByteChange {
	from: number;
	to: number;
	insert: string;
}

/** Top-level blocks `[at, at + count)` give way to `blocks`; the first new block keeps the first
 *  replaced one's id. */
export interface SpliceWindow {
	at: number;
	count: number;
	blocks: CstNode[];
}

/** The windows a splice replaces, in document order, and the document's trailing blank line. */
export interface SpliceReading {
	windows: SpliceWindow[];
	suffix: string;
}

/** `after` as changes to `before`: none when they're equal, else the one run between their
 *  shared start and end. */
export function changesBetween(before: string, after: string): ByteChange[] {
	if (before === after) return [];
	const shorter = Math.min(before.length, after.length);
	const from = sharedPrefixLength(before, after, shorter);
	const tail = sharedSuffixLength(before, after, shorter - from);
	return [{ from, to: before.length - tail, insert: after.slice(from, after.length - tail) }];
}

/** `before[from, to)` with `made`, the changes inside it, made. */
export function changedBytes(
	before: string,
	from: number,
	to: number,
	made: readonly ByteChange[]
): string {
	let text = '';
	let at = from;
	for (const change of made) {
		text += before.slice(at, change.from) + change.insert;
		at = change.to;
	}
	return text + before.slice(at, to);
}

/** Where each block of a list's bytes ends, its blank lines and its own bytes counted, from
 *  the end of the blank lines above them all. */
export function segmentEnds(list: {
	readonly prefix: string;
	readonly children: readonly NodeView[];
}): number[] {
	const ends: number[] = [];
	let at = list.prefix.length;
	for (const child of list.children)
		ends.push((at += child.leadingTrivia.length + child.raw.length));
	return ends;
}

/** `doc`, whose bytes are `before`, read again with `changes` made (sorted, none overlapping),
 *  each change in its own window unless they grow into each other; null when none changes a byte. */
export function spliceReading(
	doc: DocumentView,
	before: string,
	changes: readonly ByteChange[],
	grammar: GrammarView
): SpliceReading | null {
	const made = changes.filter((change) => before.slice(change.from, change.to) !== change.insert);
	if (made.length === 0) return null;
	const children = doc.children;
	const last = children.length - 1;
	const ends = segmentEnds(doc);
	const readings = unfinishedReadings(grammar);
	const rawStartOf = (i: number) =>
		(i === 0 ? doc.prefix.length : ends[i - 1]) + children[i].leadingTrivia.length;
	const holding = (byte: number) => {
		const i = ends.findIndex((end) => byte < end);
		return i < 0 ? last : i;
	};
	const pending: Span[] = [];
	for (const change of made) {
		const first = holding(change.from);
		let lo = first - 1;
		while (lo > 0 && isBlankParagraph(children[lo])) lo--;
		lo = Math.max(lo, 0);
		// A closer the change writes finishes a block above it that waits on one.
		const waiting = waitingAboveClosedBy(written(change), (i) => children[i].raw, lo, readings);
		const hi = Math.max(first, holding(Math.max(change.to - 1, change.from)));
		let span: Span = { lo: waiting >= 0 ? waiting : lo, hi, top: first === 0, changes: [change] };
		while (pending.length > 0 && span.lo <= pending[pending.length - 1].hi) {
			const above = pending.pop()!;
			span = {
				lo: Math.min(above.lo, span.lo),
				hi: Math.max(above.hi, span.hi),
				top: above.top || span.top,
				changes: [...above.changes, ...span.changes]
			};
		}
		pending.push(span);
	}
	const windows: SpliceWindow[] = [];
	let suffix = doc.suffix;
	while (pending.length > 0) {
		const span = pending.shift()!;
		// From the document's top a read takes every blank line as a block; elsewhere the window
		// starts behind the blank lines of a block no change reaches.
		const start = span.top ? doc.prefix.length : rawStartOf(span.lo);
		const carried = span.top ? '' : children[span.lo].leadingTrivia;
		for (let grow = 1; ; grow *= 2) {
			const next = pending[0];
			const k = span.hi === last ? last : textAfter(span.hi);
			if (next && (span.hi >= next.lo || k > next.lo)) {
				span.hi = Math.max(span.hi, next.hi);
				for (const change of pending.shift()!.changes) span.changes.push(change);
				continue;
			}
			const read = span.hi === last ? readTail(start, span.changes) : readUpTo(span, start, k);
			if (!read) span.hi = Math.min(last, span.hi + grow);
			else if ('closerAt' in read) span.hi = read.closerAt;
			else {
				if (read.suffix !== undefined) suffix = read.suffix;
				windows.push(trimmed(doc, span.lo, span.hi, carried, read.blocks));
				break;
			}
		}
	}
	return { windows, suffix };

	/** The whole lines `change` leaves where it was made. */
	function written(change: ByteChange): string[] {
		const from = before.lastIndexOf('\n', change.from - 1) + 1;
		// Through the line break, so a CRLF line's `\r` leaves with its ending.
		const end = before.indexOf('\n', change.to);
		const rest = before.slice(change.to, end < 0 ? before.length : end + 1);
		return splitLines(before.slice(from, change.from) + change.insert + rest).map((l) => l.text);
	}

	/** The first block after `hi` with text of its own, or the last block. */
	function textAfter(hi: number): number {
		let k = hi + 1;
		while (k < last && isBlankParagraph(children[k])) k++;
		return k;
	}

	/** The window from `start` to the document's end, its trailing blank line included. */
	function readTail(start: number, made: readonly ByteChange[]) {
		const read = readOpened(changedBytes(before, start, before.length, made), grammar);
		// An emptied document keeps one empty paragraph, with no bytes of its own.
		const blocks = read.children.length > 0 || start > 0 ? read.children : [emptyBlock()];
		return { blocks, suffix: read.suffix };
	}

	/** The window through block `span.hi`, when block `k` (the next with text) still starts where
	 *  it stood, the blank blocks before it reading as they did. */
	function readUpTo(
		span: Span,
		start: number,
		k: number
	): { blocks: CstNode[]; suffix?: undefined } | { closerAt: number } | null {
		const { hi } = span;
		if (isBlankParagraph(children[k])) return null;
		const head = changedBytes(before, start, ends[hi], span.changes);
		const next = children[k].raw;
		const lookahead =
			before.slice(ends[hi], rawStartOf(k)) + next.slice(0, next.indexOf('\n') + 1 || next.length);
		const blocks = readOpened(head + lookahead, grammar).children;
		let at = 0;
		let m = 0;
		while (m < blocks.length && at < head.length)
			at += blocks[m].leadingTrivia.length + blocks[m++].raw.length;
		if (at !== head.length) return null;
		for (let j = hi + 1; j <= k; j++) {
			const was = children[j];
			const now = blocks[m + j - hi - 1];
			if (!now || now.leadingTrivia !== was.leadingTrivia) return null;
			if (j < k && (now.kind !== was.kind || now.raw !== was.raw)) return null;
		}
		// A block the window leaves waiting on a closer reads on to the first line below that may be it.
		const closerAt = closerBelow(blocks.slice(0, m), hi);
		return closerAt < 0 ? { blocks: blocks.slice(0, m) } : { closerAt };
	}

	/** The first block below `hi` with a line that may close one `read` leaves waiting, or -1. */
	function closerBelow(read: readonly CstNode[], hi: number): number {
		// A reading no line closes (a link definition's) waits on nothing below.
		const waiting = readings.filter(
			(reading) => reading.closer !== null && read.some((block) => reading.notFinal(block.raw))
		);
		if (waiting.length === 0) return -1;
		const closes = (line: { text: string }) => waiting.some((r) => r.mayClose(line.text));
		for (let c = hi + 1; c <= last; c++) if (splitLines(children[c].raw).some(closes)) return c;
		return -1;
	}
}

/** Top-level blocks `[lo, hi]` and the changes they read with. */
interface Span {
	lo: number;
	hi: number;
	top: boolean;
	changes: ByteChange[];
}

// ── Internal ─────────────────────────────────────────────────────────────────

const readOpened = (text: string, grammar: GrammarView) =>
	readAsOpened(text, { grammar, scope: 'document' });

const emptyBlock = (): CstNode => ({ kind: 'paragraph', leadingTrivia: '', raw: '' });

/** The window `[lo, hi]` as read, its first block given the blank lines `carried`, less the blocks
 *  at either end that read as they stood, which stay as they are. */
function trimmed(
	doc: DocumentView,
	lo: number,
	hi: number,
	carried: string,
	read: CstNode[]
): SpliceWindow {
	const old = doc.children;
	if (read.length > 0) read[0] = { ...read[0], leadingTrivia: carried + read[0].leadingTrivia };
	const same = (a: CstNode, b: NodeView | undefined) =>
		!!b && a.kind === b.kind && a.leadingTrivia === b.leadingTrivia && a.raw === b.raw;
	let head = 0;
	while (head < read.length && lo + head <= hi && same(read[head], old[lo + head])) head++;
	let tail = 0;
	while (
		tail < read.length - head &&
		hi - tail >= lo + head &&
		same(read[read.length - 1 - tail], old[hi - tail])
	)
		tail++;
	const blocks = read.slice(head, read.length - tail);
	const at = lo + head;
	const count = hi - lo + 1 - head - tail;
	// Read, never written: its unchanged children move into the new block as they are.
	if (blocks.length > 0 && count > 0) keepUnchangedDeep(old[at] as CstNode, blocks[0]);
	return { at, count, blocks };
}
