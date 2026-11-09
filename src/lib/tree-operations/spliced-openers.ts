/**
 * The closers a byte splice's changes need: an opener a change writes onto a line gets its closing
 * line when a block below would close it otherwise, as every other write gives it, in the list the
 * change sits in, however deep. The byte splice writes them in before it reads the changes again.
 */

import type { CstNode } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import { unfinishedReadings, type GrammarView } from '../schema/block-openers';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { rebuildAncestryRaw } from '../schema/container-raw';
import { unchangedEnds } from '../block-id';
import { recordSiblingsCompared } from '../perf/instruments';
import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';
import { applied, segmentEnds, type SpliceReading } from './byte-splice';
import { changedBytes, changesBetween, narrowed, type ByteChange } from './byte-changes';
import { fragmentReaderAt } from './list/task-paragraph';
import { withClosers, writtenOpenerClosers, type WrittenCloser } from './written-openers';

/** The closing lines `changes` to `before`, the bytes of `doc`, need, each at a byte of the changed
 *  text; `reading` is the splice's read of the changes, where a container they reach is read again. */
export function splicedOpenerClosers(
	doc: DocumentView,
	before: string,
	changes: readonly ByteChange[],
	reading: SpliceReading,
	grammar: GrammarView
): WrittenCloser[] {
	const children = doc.children;
	const ends = segmentEnds(doc);
	const out: WrittenCloser[] = [];
	let after: readonly NodeView[] | null = null;
	let shift = 0;
	const narrow = changes.flatMap((change) => narrowed(before, change));
	for (const group of groupsOf(children, ends, narrow)) {
		const { first, hi } = group;
		const node = children[first];
		const grown = group.changes.reduce((n, c) => n + c.insert.length - (c.to - c.from), 0);
		// The bytes on either side of the change are as they were: the container starts or ends there.
		const start = (first === 0 ? doc.prefix.length : ends[first - 1]) + shift;
		const now =
			first === hi && isContainer(node)
				? counterpart(
						(after ??= applied(doc, reading).children),
						doc.prefix.length,
						node.kind,
						start,
						ends[hi] + shift + grown
					)
				: null;
		const read = reading.windows.find((window) => window.at === first)?.run;
		const nested = now && closersInside(node, now.node, grammar, read);
		if (nested) {
			const base = now.at + now.node.leadingTrivia.length;
			for (const closer of nested) out.push({ at: base + closer.at, text: closer.text });
		} else {
			const from = Math.min(ends[first] - node.raw.length, group.changes[0].from);
			const to = Math.max(ends[hi], group.changes[group.changes.length - 1].to);
			const text = changedBytes(before, from, to, group.changes);
			const was = before.slice(from, to);
			const closers = closersIn(children, undefined, first, hi, was, text, grammar);
			for (const closer of closers) out.push({ at: from + shift + closer.at, text: closer.text });
		}
		shift += grown;
	}
	return out;
}

/** `changes` to `before` with `closers`, at bytes of the changed text, written in, each into the
 *  change before it, which grows over the bytes between, so it stays with the blocks it closes. */
export function withSplicedClosers(
	before: string,
	changes: readonly ByteChange[],
	closers: readonly WrittenCloser[]
): ByteChange[] {
	const out = changes.map((change) => ({ ...change }));
	const starts: number[] = [];
	let shift = 0;
	for (const change of changes) {
		starts.push(change.from + shift);
		shift += change.insert.length - (change.to - change.from);
	}
	// Last first, so the offsets of the closers still to come hold in the change they go into.
	for (const closer of [...closers].reverse()) {
		const k = starts.findLastIndex((start) => start <= closer.at);
		// A closer comes after the opener a change wrote; one before every change is left to G1.158.
		if (k < 0) continue;
		const change = out[k];
		const at = closer.at - starts[k];
		if (at > change.insert.length) {
			const to = change.to + at - change.insert.length;
			change.insert += before.slice(change.to, to);
			change.to = to;
		}
		change.insert = withClosers(change.insert, [{ at, text: closer.text }]);
	}
	return out;
}

/** G1.158 at the byte splice: its changes write no opener a block below would close. Shares its
 *  code with the rule, so it catches a splice that skipped the rule, not a wrong closer. */
export function checkSplicedChangesClosed(
	doc: DocumentView,
	before: string,
	changes: readonly ByteChange[],
	reading: SpliceReading,
	grammar: GrammarView
): InvariantViolation | null {
	const closers = splicedOpenerClosers(doc, before, changes, reading, grammar);
	if (closers.length === 0) return null;
	return {
		code: 'spliced-opener-closed',
		message: 'a byte splice wrote an opener that reads down into the blocks below',
		detail: { changes, closers }
	};
}

// ── Internal ─────────────────────────────────────────────────────────────────

/** The changes grouped by the top-level blocks they reach, two that reach one block in one group. */
function groupsOf(
	children: readonly NodeView[],
	ends: readonly number[],
	changes: readonly ByteChange[]
): { first: number; hi: number; changes: ByteChange[] }[] {
	const holding = (byte: number) => {
		const i = ends.findIndex((end) => byte < end);
		return i < 0 ? children.length - 1 : i;
	};
	const groups: { first: number; hi: number; changes: ByteChange[] }[] = [];
	for (const change of changes) {
		const first = holding(change.from);
		const hi = Math.max(first, holding(Math.max(change.to - 1, change.from)));
		const last = groups[groups.length - 1];
		if (last && first <= last.hi) {
			last.hi = Math.max(last.hi, hi);
			last.changes.push(change);
		} else groups.push({ first, hi, changes: [change] });
	}
	return groups;
}

/** How many children at either end `now` holds as `was` did, counted for the cost row. */
function keptEnds(was: readonly NodeView[], now: readonly NodeView[]) {
	const ends = unchangedEnds(was, now);
	recordSiblingsCompared(ends.head + ends.tail);
	return ends;
}

/** The closers a change inside container `was`, read again as `now`, needs in `now`'s bytes; null
 *  when it changed no child's bytes. `read` names the children the splice read again. */
function closersInside(
	was: NodeView,
	now: NodeView,
	grammar: GrammarView,
	read?: { at: number; count: number }
): WrittenCloser[] | null {
	const path: number[] = [];
	let old = was;
	let is = now;
	for (;;) {
		const kids = old.children!;
		// Only the children that changed are joined: the run the read named, else the ones that differ.
		const { head, tail } =
			read && old === was
				? { head: read.at, tail: kids.length - read.at - read.count }
				: keptEnds(kids, is.children!);
		const olds = kids.slice(head, kids.length - tail);
		const news = is.children!.slice(head, is.children!.length - tail);
		const [change] = changesBetween(bytesOf(olds), bytesOf(news));
		if (!change) return path.length === 0 ? null : [];
		const ends = segmentEnds({ prefix: '', children: olds });
		let first = ends.findIndex((end) => change.from < end);
		const hi = Math.max(
			first,
			ends.findIndex((end) => Math.max(change.to - 1, change.from) < end)
		);
		if (first < 0) return [];
		// A container's own first line (`:::tip`) holds no opener, so the write starts below it.
		while (first < hi && contextual(olds[first]) && news[first]?.kind === olds[first].kind) first++;
		const start = first === 0 ? 0 : ends[first - 1];
		const from = bytesOf(news.slice(0, first)).length;
		const to = ends[hi] + change.insert.length - (change.to - change.from);
		const next =
			first === hi && isContainer(olds[first])
				? counterpart(news, 0, olds[first].kind, from, to)
				: null;
		if (next) {
			path.push(head + next.index);
			old = olds[first];
			is = next.node;
			continue;
		}
		const text = bytesOf(news).slice(from, to);
		const replaced = bytesOf(olds).slice(start, ends[hi]);
		const at = head + first;
		const closers = closersIn(kids, old, at, head + hi, replaced, text, grammar);
		if (closers.length === 0) return [];
		const placed = fragmentReaderAt(old, at, grammar)(withClosers(text, closers));
		const blocks = placed.children.map((block, k) =>
			k === 0 ? { ...block, leadingTrivia: placed.prefix + block.leadingTrivia } : block
		);
		if (blocks.length === 0) return [];
		blocks[blocks.length - 1] = { ...blocks.at(-1)!, raw: blocks.at(-1)!.raw + placed.suffix };
		const closed = copyAlong(now, path);
		closed.at.children = [
			...is.children!.slice(0, at),
			...blocks,
			...kids.slice(head + hi + 1)
		] as CstNode[];
		rebuildAncestryRaw(closed.root, [...path, 0], grammar);
		return insertedLines(now.raw, closed.root.raw) ?? [];
	}
}

/** The closers blocks `[first, hi]` of `children`, under `owner`, need when their bytes `was` are
 *  written as `text`; a kind with no reading of its own (a table cell) holds no opener. */
function closersIn(
	children: readonly NodeView[],
	owner: NodeView | undefined,
	first: number,
	hi: number,
	was: string,
	text: string,
	grammar: GrammarView
): WrittenCloser[] {
	if (children.slice(first, hi + 1).some(contextual)) return [];
	const read = fragmentReaderAt(owner, first, grammar);
	return writtenOpenerClosers(children, hi, was, text, read, unfinishedReadings(grammar));
}

/** Blocks' bytes as they read on their own, blank lines and all. */
const bytesOf = (blocks: readonly NodeView[]): string =>
	blocks.map((block) => block.leadingTrivia + block.raw).join('');

/** The block of `children`, laid out from byte `base`, of `kind` whose blank lines start at byte
 *  `start` or that ends at byte `end`, and the byte its blank lines start at. */
function counterpart(
	children: readonly NodeView[],
	base: number,
	kind: string,
	start: number,
	end: number
): { node: NodeView; index: number; at: number } | null {
	let at = base;
	for (let index = 0; index < children.length && at <= end; index++) {
		const node = children[index];
		const next = at + node.leadingTrivia.length + node.raw.length;
		if (node.kind === kind && (at === start || next === end)) return { node, index, at };
		at = next;
	}
	return null;
}

/** `root` copied down `path`, each container on the way with a children array of its own. */
function copyAlong(root: NodeView, path: readonly number[]): { root: CstNode; at: CstNode } {
	const top = { ...root, children: [...root.children!] } as CstNode;
	let at = top;
	for (const i of path) {
		const child = { ...at.children![i], children: [...at.children![i].children!] } as CstNode;
		at.children![i] = child;
		at = child;
	}
	return { root: top, at };
}

/** `closed`'s lines that `raw` lacks, each where it goes in `raw`; null when `raw`'s lines are not
 *  all in `closed`, in order. */
function insertedLines(raw: string, closed: string): WrittenCloser[] | null {
	const out: WrittenCloser[] = [];
	const lineEnd = (text: string, at: number) => {
		const end = text.indexOf('\n', at);
		return end < 0 ? text.length : end + 1;
	};
	let i = 0;
	for (let j = 0; j < closed.length;) {
		const end = lineEnd(closed, j);
		const line = closed.slice(j, end);
		if (i < raw.length && raw.slice(i, lineEnd(raw, i)) === line) i = lineEnd(raw, i);
		else if (out.at(-1)?.at === i) out[out.length - 1].text += line;
		else out.push({ at: i, text: line });
		j = end;
	}
	return i === raw.length ? out : null;
}

const isContainer = (node: NodeView): boolean =>
	!!tryGetBlockKindDescriptor(node.kind)?.isContainer && !!node.children?.length;

const contextual = (node: NodeView): boolean =>
	!!tryGetBlockKindDescriptor(node.kind)?.contextDependentKind;
