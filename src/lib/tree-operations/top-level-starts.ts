/**
 * Where each top-level block sits in a document's bytes: block `i` starts, blank lines first, where
 * block `i - 1` ends, and block 0 starts past the document's prefix. No block is read until the
 * first question; the lengths are then plain numbers, summed only as far as a question reaches, so
 * an answer after a change costs the blocks between the change and the question. A document nobody
 * keeps is measured on its own (`measured`); the editor's own record is told what each write
 * changed (`editor-actions/commit/kept-starts.ts`).
 */

import type { DocumentView } from '../core/node-views';
import { recordTopBlocksMeasured } from '../perf/instruments';
import { spliceMany } from './splice-many';

export interface TopLevelStarts {
	/** The document's length, its suffix counted. */
	readonly length: number;
	/** Where block `index`'s blank lines start. */
	start(index: number): number;
	/** Past block `index`'s last byte. */
	end(index: number): number;
	/** The first block whose bytes end past `byte`, or the last; -1 in a document with none. */
	holding(byte: number): number;
}

/** A document and the starts that describe it: the pair every reader of a position takes, so the
 *  starts of one document are never asked about another. */
export interface Measured {
	readonly doc: DocumentView;
	readonly starts: TopLevelStarts;
}

/** Top-level blocks `[at, at + removed)`, as they stood before a write, gave way to `inserted`. */
export interface TopLevelChange {
	at: number;
	removed: number;
	inserted: number;
}

/** Each block's length, blank lines and bytes, and their running sums as far as `summed`. */
export interface BlockLengths {
	lengths: number[];
	sums: number[];
	summed: number;
}

/** `doc` with starts of its own: for a document nobody keeps (a snapshot, a parse). */
export function measured(doc: DocumentView): Measured {
	let own: BlockLengths | undefined;
	return { doc, starts: startsOver(doc, () => (own ??= blockLengths(doc))) };
}

export function blockLengths(doc: DocumentView): BlockLengths {
	return { lengths: lengthsOf(doc, 0, doc.children.length), sums: [], summed: 0 };
}

/** The answers about `doc` that `kept`, asked at each question, gives from its blocks' lengths. */
export function startsOver(doc: DocumentView, kept: () => BlockLengths): TopLevelStarts {
	const end = (index: number): number => {
		const own = kept();
		const { lengths, sums } = own;
		for (let i = own.summed; i <= index; i++) sums[i] = (i > 0 ? sums[i - 1] : 0) + lengths[i];
		own.summed = Math.max(own.summed, index + 1);
		return doc.prefix.length + sums[index];
	};
	const start = (index: number) => (index === 0 ? doc.prefix.length : end(index - 1));
	return {
		get length() {
			return start(kept().lengths.length) + doc.suffix.length;
		},
		start,
		end,
		holding(byte) {
			let lo = 0;
			let hi = kept().lengths.length - 1;
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				if (byte < end(mid)) hi = mid;
				else lo = mid + 1;
			}
			return hi;
		}
	};
}

/** `kept` brought up to `doc` as `changes` left it: runs in document order, none overlapping, each
 *  `at` counted before any of them was made. Only the blocks the runs put in are read. */
export function applyChanges(
	doc: DocumentView,
	kept: BlockLengths,
	changes: readonly TopLevelChange[]
): void {
	let grown = 0;
	const placed = changes.map((change) => {
		const at = change.at + grown;
		grown += change.inserted - change.removed;
		return lengthsOf(doc, at, at + change.inserted);
	});
	// Last run first, so each one's `at` still holds.
	for (let i = changes.length - 1; i >= 0; i--) {
		spliceMany(kept.lengths, changes[i].at, changes[i].removed, placed[i]);
	}
	if (changes.length > 0) kept.summed = Math.min(kept.summed, changes[0].at);
}

/** The smallest run outside which each block is one object in `before`, in `after` and, counted
 *  from the same end, in `shared`: the undo snapshot, which holds no block a write changes in place. */
export function changedRun<T>(
	before: readonly T[],
	after: readonly T[],
	shared: readonly T[]
): TopLevelChange {
	const most = Math.min(before.length, after.length);
	const same = (b: number, a: number, s: number) =>
		before[b] === after[a] && shared[s] === after[a];
	let head = 0;
	while (head < most && same(head, head, head)) head++;
	let tail = 0;
	while (
		tail < most - head &&
		same(before.length - 1 - tail, after.length - 1 - tail, shared.length - 1 - tail)
	)
		tail++;
	return { at: head, removed: before.length - head - tail, inserted: after.length - head - tail };
}

function lengthsOf(doc: DocumentView, from: number, to: number): number[] {
	recordTopBlocksMeasured(to - from);
	const tops = doc.children;
	const lengths: number[] = [];
	// Indexed: the list may be a `$state` proxy, where an iterator pays a trap per step.
	for (let i = from; i < to; i++) {
		const top = tops[i];
		lengths.push(top.leadingTrivia.length + top.raw.length);
	}
	return lengths;
}
