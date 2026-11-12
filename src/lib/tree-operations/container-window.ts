/**
 * The byte splice's window inside a top-level list, quote or table: the run of children a change
 * reaches, read again the way the whole document is read and spliced into a copy of the
 * container, so an edit in a long container reads a few of its children instead of all of them.
 * Whatever may reach past the run takes the top-level window (`docs/design/commit-and-undo.md`).
 */

import type { CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { isBlankParagraph } from '../core/parser';
import { splitLines } from '../core/lines';
import { countsAfterRewrite } from '../core/parsers/list';
import { waitRunsPast, waitingAboveThrough, type UnfinishedReading } from '../schema/block-openers';
import { blockFacts } from '../schema/block-facts';
import { spanHolding } from '../schema/child-spans';
import { assignChildIdsDeep, keepUnchangedDeep } from '../block-id';
import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
import { changedBytes, takenLines, writtenLines, type ByteChange } from './byte-changes';
import type { SpliceWindow } from './byte-splice';
import type { Measured } from './top-level-starts';

/** What the window reads with: the document and where its top-level blocks sit, its bytes, and
 *  the reader the whole document takes. */
export interface TopLevel extends Measured {
	before: string;
	readings: readonly UnfinishedReading[];
	read(text: string): { children: CstNode[]; suffix: string };
}

/** The window `changes`, cut down to the bytes they change, take inside top-level block `t`, which
 *  holds them all; null where only the top-level window will do. */
export function containerWindow(
	top: TopLevel,
	t: number,
	changes: readonly ByteChange[]
): { window: SpliceWindow; suffix?: string } | null {
	const node = top.doc.children[t];
	const kids = node.children;
	const spans = node.childSpans;
	const lines = blockFacts(node.kind).lines;
	if (lines !== 'items' && lines !== 'every-line' && lines !== 'rows') return null;
	if (!kids || kids.length < 2 || spans?.length !== kids.length * 2) return null;
	const base = top.starts.rawStart(t);
	let first = kids.length;
	let hi = -1;
	for (const change of changes) {
		const from = spanHolding(spans, change.from - base);
		const to = spanHolding(spans, Math.max(change.to - 1, change.from) - base);
		if (from < 0 || to < 0) return null;
		first = Math.min(first, from);
		hi = Math.max(hi, to);
	}
	// Child 0 holds the container's own first line, and a table's header sits above its delimiter.
	if (first < 1 || reachesPast(top.before, changes, top.readings)) return null;
	if (waitsInto(top.doc.children, t, top.readings)) return null;
	// Every item and every quote line opens its container again; a table's rows need its head.
	const head = lines === 'rows' ? 1 : 0;
	// A row or an item is no block of its own, so none of them waits on a line below it.
	const readings = lines === 'every-line' ? top.readings : [];
	const lo = windowStart(kids, first, head, readings);
	const run: Run = {
		top,
		readings,
		t,
		lo,
		hi,
		headText: node.raw.slice(0, spans[head * 2]),
		// Read from behind the start child's blank lines, which it keeps, as the top level does.
		start: spans[lo * 2] + blankLinesLength(node, lo)
	};
	for (let grow = 1; ; grow *= 2) {
		const from = base + run.start;
		const to = base + spans[run.hi * 2 + 1];
		const was = readRun(run, top.before.slice(from, to));
		if (was === 'moved' || was === 'mismatch') return null;
		if (!readsAsHeld(was.blocks, kids, run.lo, run.hi)) {
			assertInvariant('container-window-reads-back', () => ({
				code: 'container-window-reads-back',
				message: `${node.kind}: children ${run.lo}-${run.hi} read back as other blocks`,
				detail: { kind: node.kind, lo: run.lo, hi: run.hi }
			}));
			return null;
		}
		const text = changedBytes(top.before, from, to, changes);
		const now = readRun(run, text);
		if (now === 'mismatch') return null;
		if (now === 'moved') {
			if (run.hi === kids.length - 1) return null;
			run.hi = Math.min(kids.length - 1, run.hi + grow);
			continue;
		}
		if (now.waitsTo !== undefined) {
			run.hi = now.waitsTo;
			continue;
		}
		const window = {
			at: t,
			count: 1,
			blocks: [spliced(run, text, to - from, now)],
			run: { at: run.lo, count: run.hi - run.lo + 1 }
		};
		return { window, suffix: now.suffix };
	}
}

// ── Where a window starts ────────────────────────────────────────────────────

/** The block a window starts at for a change beginning in block `first`: the last one above with
 *  text, or a block higher up whose wait reaches that far, as a definition's does for its title. */
export function windowStart(
	blocks: readonly NodeView[],
	first: number,
	floor: number,
	readings: readonly UnfinishedReading[]
): number {
	let lo = first - 1;
	while (lo > floor && isBlankParagraph(blocks[lo])) lo--;
	lo = Math.max(lo, floor);
	const waiting = waitingAboveThrough((i) => blocks[i], lo, floor, readings);
	return waiting < 0 ? lo : waiting;
}

// ── Where a window stops ─────────────────────────────────────────────────────

/** The first of `blocks` after index `at` with text of its own, or the last. */
export function textAfter(blocks: readonly NodeView[], at: number): number {
	let k = at + 1;
	while (k < blocks.length - 1 && isBlankParagraph(blocks[k])) k++;
	return k;
}

/** Whether `read` holds the blocks after `was[at]` up to `k`, the next with text, as they stood: the
 *  blank ones whole and `k` starting where it did, so every block past it reads as it did too. */
export function standsBelow(
	was: readonly NodeView[],
	at: number,
	k: number,
	read: readonly CstNode[]
): boolean {
	if (read.length !== k - at) return false;
	for (let j = at + 1; j <= k; j++) {
		const now = read[j - at - 1];
		if (now.leadingTrivia !== was[j].leadingTrivia) return false;
		if (j < k && (now.kind !== was[j].kind || now.raw !== was[j].raw)) return false;
	}
	return true;
}

// ── The read ─────────────────────────────────────────────────────────────────

/** Children `[lo, hi]` of top-level block `t`, read from byte `start` of its raw. */
interface Run {
	top: TopLevel;
	/** The readings a child of the container may wait under; none where a child is no block. */
	readings: readonly UnfinishedReading[];
	t: number;
	lo: number;
	hi: number;
	/** A table's header and delimiter lines, which its rows read under; empty otherwise. */
	headText: string;
	start: number;
}

interface RunRead {
	blocks: CstNode[];
	/** Each child's bytes in the container's raw, counted from the run's first byte. */
	spans: Uint32Array;
	metadata: CstNode['metadata'];
	/** The document's trailing blank line, when the read ran to its end. */
	suffix?: string;
	/** Set where a block of the read still waits past its end: the child its wait can run on to. */
	waitsTo?: number;
}

/** `text` read in the run's place, the way the document reads it: `moved` where the run's end or
 *  the next block moved, `mismatch` where it reads as no children of one such container. */
function readRun(run: Run, text: string): RunRead | 'moved' | 'mismatch' {
	const { top, t, hi, headText } = run;
	const node = top.doc.children[t];
	const kids = node.children!;
	const spans = node.childSpans!;
	const last = hi === kids.length - 1;
	const k = last ? -1 : textAfter(kids, hi);
	const after = last
		? tailAfter(top, t)
		: node.raw.slice(spans[(hi + 1) * 2], spans[k * 2]) + nextLine(node, k);
	if (after === null) return 'mismatch';
	const read = top.read(headText + text + after);
	const container = read.children[0];
	const readSpans = container?.childSpans;
	if (!container?.children || !readSpans || container.kind !== node.kind) return 'mismatch';
	if (container.leadingTrivia !== '' || !sameMetadata(container.metadata, node.metadata)) {
		return 'mismatch';
	}
	const head = headText === '' ? 0 : 1;
	for (let i = 0; i < head; i++) if (container.children[i]?.raw !== kids[i].raw) return 'mismatch';
	const end = headText.length + text.length;
	let m = head;
	while (m < container.children.length && readSpans[m * 2 + 1] < end) m++;
	if (m >= container.children.length || readSpans[m * 2 + 1] !== end) return 'moved';
	const blocks = container.children.slice(head, m + 1);
	blocks[0] = { ...blocks[0], leadingTrivia: kids[run.lo].leadingTrivia + blocks[0].leadingTrivia };
	const runSpans = readSpans.slice(head * 2, (m + 1) * 2).map((at) => at - headText.length);
	const found = { blocks, spans: runSpans, metadata: container.metadata };
	const below = container.children.slice(m + 1);
	if (!last) {
		if (!standsBelow(kids, hi, k, below)) return 'moved';
		// Asked of the new bytes alone: the bytes as they stood read as held, wait and all.
		const to = waitRunsPast(container.children, (i) => kids[i], k, kids.length - 1, run.readings);
		return { ...found, waitsTo: to < 0 ? undefined : to };
	}
	const ownTail = container.innerSuffix ?? '';
	if (below.length > 0 || ownTail !== (node.innerSuffix ?? '')) return 'moved';
	const tops = top.doc.children;
	const rest = read.children.slice(1);
	const stands =
		t === tops.length - 1 ? rest.length === 0 : standsBelow(tops, t, textAfter(tops, t), rest);
	if (!stands) return 'moved';
	// Only a read that ran to the document's end saw its trailing blank line.
	return t === tops.length - 1 ? { ...found, suffix: read.suffix } : found;
}

/** What follows a run ending at the container's last child: the container's own trailing lines,
 *  then the top level's blank lines and the next block's first line, or the rest of the document. */
function tailAfter(top: TopLevel, t: number): string | null {
	const { doc, before } = top;
	const node = doc.children[t];
	const own = node.raw.slice(node.childSpans!.at(-1));
	if (t === doc.children.length - 1) return own + before.slice(top.starts.end(t));
	const k = textAfter(doc.children, t);
	if (isBlankParagraph(doc.children[k])) return null;
	const next = doc.children[k].raw;
	const firstLine = next.slice(0, next.indexOf('\n') + 1 || next.length);
	return own + before.slice(top.starts.end(t), top.starts.rawStart(k)) + firstLine;
}

/** Child `index`'s blank lines and its first line, the bytes that say where it starts. */
function nextLine(node: NodeView, index: number): string {
	const spans = node.childSpans!;
	const region = node.raw.slice(spans[index * 2], spans[index * 2 + 1]);
	const at = blankLinesLength(node, index);
	return region.slice(0, region.indexOf('\n', at) + 1 || region.length);
}

/** How many bytes of child `index`'s region its blank lines take, markers and all. */
function blankLinesLength(node: NodeView, index: number): number {
	const region = node.raw.slice(node.childSpans![index * 2], node.childSpans![index * 2 + 1]);
	let lines = splitLines(node.children![index].leadingTrivia).length;
	let at = 0;
	while (lines-- > 0) at = region.indexOf('\n', at) + 1;
	return at;
}

// ── The copy ─────────────────────────────────────────────────────────────────

/** A copy of the container with the run's children, whose bytes ran `length` long, given way to
 *  those read from `text`; every other child stays the node it was, ids and all. */
function spliced(run: Run, text: string, length: number, read: RunRead): CstNode {
	const node = run.top.doc.children[run.t];
	const { lo, hi } = run;
	const kids = node.children!;
	const spans = node.childSpans!;
	const held = {
		kind: node.kind,
		children: kids.slice(lo, hi + 1),
		childIds: node.childIds?.slice(lo, hi + 1)
	} as CstNode;
	const fresh = { kind: node.kind, children: read.blocks.slice() } as CstNode;
	// Read, never written: the unchanged ends of the run move into the copy as they are.
	keepUnchangedDeep(held, fresh);
	for (const child of fresh.children!) assignChildIdsDeep(child);
	const added = fresh.children!.length;
	const out = new Uint32Array((kids.length - (hi - lo + 1) + added) * 2);
	out.set(spans.subarray(0, lo * 2));
	read.spans.forEach((at, i) => (out[lo * 2 + i] = at + run.start));
	// The start child's span keeps the blank lines read from behind.
	out[lo * 2] = spans[lo * 2];
	const shift = text.length - length;
	spans.subarray((hi + 1) * 2).forEach((at, i) => (out[(lo + added) * 2 + i] = at + shift));
	const copy = {
		...node,
		raw: node.raw.slice(0, run.start) + text + node.raw.slice(spans[hi * 2 + 1]),
		metadata: read.metadata,
		children: [...kids.slice(0, lo), ...fresh.children!, ...kids.slice(hi + 1)],
		childSpans: out
	} as CstNode;
	delete copy.ownerEpoch;
	if (node.childIds && fresh.childIds) {
		copy.childIds = [
			...node.childIds.slice(0, lo),
			...fresh.childIds,
			...node.childIds.slice(hi + 1)
		];
	}
	if (node.markerWidths) {
		copy.markerWidths = widthsAcross(node.markerWidths, held.children!, fresh.children!);
	}
	return copy;
}

/** A list's marker-width counts once `removed` items gave way to `added`. */
function widthsAcross(
	counts: Uint32Array,
	removed: readonly NodeView[],
	added: readonly NodeView[]
): Uint32Array {
	for (const item of removed) counts = countsAfterRewrite(counts, item.raw, '');
	for (const item of added) counts = countsAfterRewrite(counts, '', item.raw);
	return counts;
}

// ── Internal ─────────────────────────────────────────────────────────────────

/** Whether the run's old bytes read back as the children it held, so the spans said where they
 *  sit and the container's own reading agrees with the document's. */
function readsAsHeld(
	blocks: readonly CstNode[],
	kids: readonly NodeView[],
	lo: number,
	hi: number
): boolean {
	if (blocks.length !== hi - lo + 1) return false;
	return blocks.every((block, i) => {
		const was = kids[lo + i];
		return (
			block.kind === was.kind && block.leadingTrivia === was.leadingTrivia && block.raw === was.raw
		);
	});
}

/** Whether a line the changes write or take could open or close a block reading past its
 *  container (a fence, `$$`, `:::name`, `<details>`); asked with and without its markers. */
function reachesPast(
	before: string,
	changes: readonly ByteChange[],
	readings: readonly UnfinishedReading[]
): boolean {
	const opens = (text: string) =>
		readings.some((r) => (r.closer !== null && r.mayClose(text)) || r.notFinal(text + '\n'));
	return changes.some((change) =>
		[...writtenLines(before, change), ...takenLines(before, change)].some((line) => {
			const quoted = line.replace(/^[ \t>]*/, '');
			return [line, quoted, quoted.replace(/^(?:[-+*]|\d{1,9}[.)])[ \t]+/, '')].some(opens);
		})
	);
}

/** Whether a block above `blocks[at]` still waits at the end of that block's first line, under a
 *  reading no line closes: a change further down in the block can alter the one that waits. */
function waitsInto(
	blocks: readonly NodeView[],
	at: number,
	readings: readonly UnfinishedReading[]
): boolean {
	const { raw, leadingTrivia } = blocks[at];
	const opening = { raw: raw.slice(0, raw.indexOf('\n') + 1 || raw.length), leadingTrivia };
	return waitingAboveThrough((i) => (i === at ? opening : blocks[i]), at, 0, readings) >= 0;
}

const sameMetadata = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
