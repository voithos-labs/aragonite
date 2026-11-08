/**
 * The byte splice's window inside a top-level list, quote or table: the run of children a change
 * reaches, read again the way the whole document is read and spliced into a copy of the
 * container, so an edit in a long container reads a few of its children instead of all of them.
 * Whatever may reach past the run takes the top-level window (`docs/design/commit-and-undo.md`).
 */

import type { CstNode } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import { isBlankParagraph } from '../core/parser';
import { splitLines } from '../core/lines';
import { countsAfterRewrite } from '../core/parsers/list';
import { waitingReading, type UnfinishedReading } from '../schema/block-openers';
import { blockFacts } from '../schema/block-facts';
import { assignChildIdsDeep, keepUnchangedDeep } from '../block-id';
import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
import { changedBytes, takenLines, writtenLines, type ByteChange } from './byte-changes';
import type { SpliceWindow } from './byte-splice';

/** What the window reads with: the document, its bytes, where its top-level blocks sit, and the
 *  reader the whole document takes. */
export interface TopLevel {
	doc: DocumentView;
	before: string;
	rawStartOf(index: number): number;
	ends: readonly number[];
	readings: readonly UnfinishedReading[];
	read(text: string): { children: CstNode[]; suffix: string };
}

/** The window `changes` take inside top-level block `t`, which holds every byte of `narrowed`;
 *  null where only the top-level window will do. */
export function containerWindow(
	top: TopLevel,
	t: number,
	changes: readonly ByteChange[],
	narrowed: readonly ByteChange[]
): { window: SpliceWindow; suffix?: string } | null {
	const node = top.doc.children[t];
	const kids = node.children;
	const spans = node.childSpans;
	const lines = blockFacts(node.kind).lines;
	if (lines !== 'items' && lines !== 'every-line' && lines !== 'rows') return null;
	if (!kids || kids.length < 2 || spans?.length !== kids.length * 2) return null;
	const base = top.rawStartOf(t);
	let first = kids.length;
	let hi = -1;
	for (const change of narrowed) {
		const from = childAt(spans, change.from - base);
		const to = childAt(spans, Math.max(change.to - 1, change.from) - base);
		if (from < 0 || to < 0) return null;
		first = Math.min(first, from);
		hi = Math.max(hi, to);
	}
	// Child 0 holds the container's own first line, and a table's header sits above its delimiter.
	if (first < 1 || reachesPast(top.before, narrowed, top.readings)) return null;
	// Every item and every quote line opens its container again; a table's rows need its head.
	const head = lines === 'rows' ? 1 : 0;
	let lo = first - 1;
	while (lo > head && isBlankParagraph(kids[lo])) lo--;
	lo = Math.max(lo, head);
	const run: Run = {
		top,
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
		// A block left waiting on its closer may take in lines past the run.
		if (now.blocks.some((block) => waitingReading(block.raw, top.readings))) return null;
		const window = { at: t, count: 1, blocks: [spliced(run, text, to - from, now)] };
		return { window, suffix: now.suffix };
	}
}

// ── The read ─────────────────────────────────────────────────────────────────

/** Children `[lo, hi]` of top-level block `t`, read from byte `start` of its raw. */
interface Run {
	top: TopLevel;
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
}

/** `text` read in the run's place, the way the document reads it: `moved` where the run's end or
 *  the next block moved, `mismatch` where it reads as no children of one such container. */
function readRun(run: Run, text: string): RunRead | 'moved' | 'mismatch' {
	const { top, t, hi, headText } = run;
	const node = top.doc.children[t];
	const kids = node.children!;
	const after = hi === kids.length - 1 ? tailAfter(top, t) : nextLine(node, hi + 1);
	if (after === null) return 'mismatch';
	const read = top.read(headText + text + after);
	const container = read.children[0];
	const spans = container?.childSpans;
	if (!container?.children || !spans || container.kind !== node.kind) return 'mismatch';
	if (container.leadingTrivia !== '' || !sameMetadata(container.metadata, node.metadata)) {
		return 'mismatch';
	}
	const head = headText === '' ? 0 : 1;
	for (let i = 0; i < head; i++) if (container.children[i]?.raw !== kids[i].raw) return 'mismatch';
	const end = headText.length + text.length;
	let m = head;
	while (m < container.children.length && spans[m * 2 + 1] < end) m++;
	if (m >= container.children.length || spans[m * 2 + 1] !== end) return 'moved';
	const blocks = container.children.slice(head, m + 1);
	blocks[0] = { ...blocks[0], leadingTrivia: kids[run.lo].leadingTrivia + blocks[0].leadingTrivia };
	const runSpans = spans.slice(head * 2, (m + 1) * 2).map((at) => at - headText.length);
	const found = { blocks, spans: runSpans, metadata: container.metadata };
	if (hi < kids.length - 1) {
		// The next child starts where it stood, its blank lines as they were.
		const next = container.children[m + 1];
		if (read.children.length !== 1 || container.children.length !== m + 2) return 'moved';
		return next.leadingTrivia === kids[hi + 1].leadingTrivia ? found : 'moved';
	}
	const ownTail = container.innerSuffix ?? '';
	if (container.children.length !== m + 1 || ownTail !== (node.innerSuffix ?? '')) return 'moved';
	return standsBelow(top, t, read.children) ? { ...found, suffix: read.suffix } : 'moved';
}

/** Whether the blocks read after the container are the top-level blocks below it as they stood,
 *  up to the next with text (the top-level window's own check). */
function standsBelow(top: TopLevel, t: number, read: readonly CstNode[]): boolean {
	const children = top.doc.children;
	if (t === children.length - 1) return read.length === 1;
	const k = textAfter(children, t);
	if (read.length !== k - t + 1) return false;
	for (let j = t + 1; j <= k; j++) {
		const was = children[j];
		const now = read[j - t];
		if (now.leadingTrivia !== was.leadingTrivia) return false;
		if (j < k && (now.kind !== was.kind || now.raw !== was.raw)) return false;
	}
	return true;
}

/** What follows a run ending at the container's last child: the container's own trailing lines,
 *  then the top level's blank lines and the next block's first line, or the rest of the document. */
function tailAfter(top: TopLevel, t: number): string | null {
	const { doc, before } = top;
	const node = doc.children[t];
	const own = node.raw.slice(node.childSpans!.at(-1));
	if (t === doc.children.length - 1) return own + before.slice(top.ends[t]);
	const k = textAfter(doc.children, t);
	if (isBlankParagraph(doc.children[k])) return null;
	const next = doc.children[k].raw;
	const firstLine = next.slice(0, next.indexOf('\n') + 1 || next.length);
	return own + before.slice(top.ends[t], top.rawStartOf(k)) + firstLine;
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

/** The child whose bytes hold byte `at` of the container's, or -1 for a byte between children (a
 *  table's delimiter line, a quote's trailing blank lines). */
function childAt(spans: Uint32Array, at: number): number {
	let lo = 0;
	let hi = spans.length / 2 - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (spans[mid * 2] <= at) lo = mid;
		else hi = mid - 1;
	}
	return spans[lo * 2] <= at && at < spans[lo * 2 + 1] ? lo : -1;
}

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
		readings.some((reading) => reading.mayClose(text) || reading.notFinal(text + '\n'));
	return changes.some((change) =>
		[...writtenLines(before, change), ...takenLines(before, change)].some((line) => {
			const quoted = line.replace(/^[ \t>]*/, '');
			return [line, quoted, quoted.replace(/^(?:[-+*]|\d{1,9}[.)])[ \t]+/, '')].some(opens);
		})
	);
}

const sameMetadata = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function textAfter(children: readonly NodeView[], t: number): number {
	let k = t + 1;
	while (k < children.length - 1 && isBlankParagraph(children[k])) k++;
	return k;
}
