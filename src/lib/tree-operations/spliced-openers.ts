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
import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';
import { changesBetween, segmentEnds, type ByteChange, type SpliceReading } from './byte-splice';
import { fragmentReaderAt } from './list/task-paragraph';
import { spliceMany } from './splice-many';
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
	for (const group of groupsOf(children, ends, changes)) {
		const { first, hi } = group;
		const from = Math.min(ends[first] - children[first].raw.length, group.changes[0].from);
		const to = Math.max(ends[hi], group.changes[group.changes.length - 1].to);
		const node = children[first];
		const inside = first === hi && from === ends[first] - node.raw.length && isContainer(node);
		// The bytes before the change are as they were, so the container starts where it stood.
		const start = (first === 0 ? doc.prefix.length : ends[first - 1]) + shift;
		const now = inside
			? childAt((after ??= afterReading(doc, reading)), doc.prefix.length, start)
			: null;
		const nested = now?.node.kind === node.kind ? closersInside(node, now.node, grammar) : null;
		const closers =
			nested ??
			writtenOpenerClosers(
				children,
				hi,
				before.slice(from, to),
				changed(before, from, to, group.changes),
				fragmentReaderAt(undefined, hi, grammar),
				unfinishedReadings(grammar)
			);
		for (const closer of closers) out.push({ at: from + shift + closer.at, text: closer.text });
		for (const change of group.changes) shift += change.insert.length - (change.to - change.from);
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

/** `before[from, to)` with `made` (inside it) made. */
function changed(before: string, from: number, to: number, made: readonly ByteChange[]): string {
	let text = '';
	let at = from;
	for (const change of made) {
		text += before.slice(at, change.from) + change.insert;
		at = change.to;
	}
	return text + before.slice(at, to);
}

/** The closers a change inside container `was`, read again as `now`, needs in `now`'s bytes; null
 *  when it changed no child's bytes, as a change to the container's own lines does. */
function closersInside(was: NodeView, now: NodeView, grammar: GrammarView): WrittenCloser[] | null {
	const path: number[] = [];
	let old = was;
	let is = now;
	for (;;) {
		const [change] = changesBetween(bodyOf(old), bodyOf(is));
		if (!change) return path.length === 0 ? null : [];
		const kids = old.children!;
		const ends = segmentEnds({ prefix: '', children: kids });
		const first = ends.findIndex((end) => change.from < end);
		const hi = Math.max(
			first,
			ends.findIndex((end) => Math.max(change.to - 1, change.from) < end)
		);
		if (first < 0 || hi < 0) return [];
		const start = first === 0 ? 0 : ends[first - 1];
		const inner = kids[first];
		const next = first === hi && isContainer(inner) ? childAt(is.children!, 0, start) : null;
		if (next && next.node.kind === inner.kind) {
			path.push(next.index);
			old = inner;
			is = next.node;
			continue;
		}
		if (kids.slice(first, hi + 1).some(contextual)) return [];
		const grown = change.insert.length - (change.to - change.from);
		const text = bodyOf(is).slice(start, ends[hi] + grown);
		const read = fragmentReaderAt(old, first, grammar);
		const readings = unfinishedReadings(grammar);
		const closers = writtenOpenerClosers(
			kids,
			hi,
			bodyOf(old).slice(start, ends[hi]),
			text,
			read,
			readings
		);
		if (closers.length === 0) return [];
		const placed = read(withClosers(text, closers));
		const blocks = placed.children.map((block, k) =>
			k === 0 ? { ...block, leadingTrivia: placed.prefix + block.leadingTrivia } : block
		);
		if (blocks.length === 0) return [];
		blocks[blocks.length - 1] = { ...blocks.at(-1)!, raw: blocks.at(-1)!.raw + placed.suffix };
		const closed = copyAlong(now, path);
		closed.at.children = [...kids.slice(0, first), ...blocks, ...kids.slice(hi + 1)] as CstNode[];
		rebuildAncestryRaw(closed.root, [...path, 0], grammar);
		return insertedLines(now.raw, closed.root.raw) ?? [];
	}
}

/** A container's children's bytes as they read on their own, blank lines and all. */
const bodyOf = (node: NodeView): string =>
	(node.children ?? []).map((child) => child.leadingTrivia + child.raw).join('');

/** The block of `children`, laid out from byte `base`, whose blank lines start at byte `at`. */
function childAt(
	children: readonly NodeView[],
	base: number,
	at: number
): { node: NodeView; index: number } | null {
	let pos = base;
	for (let index = 0; index < children.length && pos <= at; index++) {
		if (pos === at) return { node: children[index], index };
		pos += children[index].leadingTrivia.length + children[index].raw.length;
	}
	return null;
}

/** The document's top-level blocks once `reading` is in. */
function afterReading(doc: DocumentView, reading: SpliceReading): readonly NodeView[] {
	const children: NodeView[] = [...doc.children];
	for (const window of [...reading.windows].reverse())
		spliceMany(children, window.at, window.count, window.blocks);
	return children;
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
