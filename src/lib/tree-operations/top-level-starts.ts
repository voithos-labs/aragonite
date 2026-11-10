/**
 * Where each top-level block sits in a document's bytes: block `i` starts, blank lines first, where
 * block `i - 1` ends, and block 0 starts past the document's prefix. The lengths are plain numbers
 * and the running ends are summed only as far as a question reaches, so an answer after a change
 * costs the blocks between the change and the question. A document nobody keeps is measured once
 * (`measured`); the editor's own record is told what each write changed
 * (`editor-actions/commit/kept-starts.ts`).
 */

import type { DocumentView } from '../core/node-views';
import { recordTopBlocksMeasured } from '../perf/instruments';
import { spliceMany } from './splice-many';

export interface TopLevelStarts {
	readonly count: number;
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

/** Each block's length, blank lines and bytes, and how many running ends are summed so far. */
export interface BlockLengths {
	lengths: number[];
	ends: number[];
	summed: number;
}

/** `doc` measured once, every block read: for a document nobody keeps (a snapshot, a parse). */
export function measured(doc: DocumentView): Measured {
	return { doc, starts: startsOver(doc, blockLengths(doc)) };
}

export function blockLengths(doc: DocumentView): BlockLengths {
	return { lengths: lengthsOf(doc, 0, doc.children.length), ends: [], summed: 0 };
}

/** The answers `kept` gives about `doc`, whose blocks it measures. */
export function startsOver(doc: DocumentView, kept: BlockLengths): TopLevelStarts {
	const end = (index: number): number => {
		if (index >= kept.summed) {
			let at = kept.summed === 0 ? doc.prefix.length : kept.ends[kept.summed - 1];
			for (let i = kept.summed; i <= index; i++) kept.ends[i] = at += kept.lengths[i];
			kept.summed = index + 1;
		}
		return kept.ends[index];
	};
	const start = (index: number) => (index === 0 ? doc.prefix.length : end(index - 1));
	return {
		get count() {
			return kept.lengths.length;
		},
		get length() {
			return start(kept.lengths.length) + doc.suffix.length;
		},
		start,
		end,
		holding(byte) {
			let lo = 0;
			let hi = kept.lengths.length - 1;
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
