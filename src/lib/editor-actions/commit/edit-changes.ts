/**
 * What each write replaced, for an `edit` listener's `changes`, kept only while one listens. As a
 * write announces, the record of the bytes before it says where each run it reported started and
 * the tree gives the blocks it put in, so a write costs its runs; a write that couldn't say costs
 * its old text's length. The changes handed out are worked out when read.
 */
import type { DocumentView } from '../../core/node-views';
import {
	piecesOf,
	type BlockBytes,
	type TopLevelChange
} from '../../tree-operations/top-level-starts';
import type { Change } from '../../editor-events';
import type { HeardWrite } from './kept-starts';

export interface EditChanges {
	/** Counts a listener in; what it returns counts it out. */
	listen(): () => void;
	/** Whether a listener stands, so each write reads the record as it stood. */
	listening(): boolean;
	/** Hears a write as it announces, `doc` as the write left it. */
	heard(write: HeardWrite, doc: DocumentView): void;
	/** The changes of the writes heard since the last call, in the bytes before the first of them,
	 *  worked out when read; `after` is the text they left, read only to span several writes. */
	take(after: () => string): () => readonly Change[];
}

export function createEditChanges(): EditChanges {
	let listeners = 0;
	let pending: Capture[] = [];
	let ends: { prefix: string; suffix: string } | null = null;
	return {
		listen() {
			listeners++;
			let counted = true;
			return () => {
				if (counted) listeners--;
				counted = false;
			};
		},
		listening: () => listeners > 0,
		heard({ runs, before }, doc) {
			const was = ends ?? { prefix: doc.prefix, suffix: doc.suffix };
			ends = { prefix: doc.prefix, suffix: doc.suffix };
			if (listeners > 0) pending.push(capture(runs, before, doc, was));
		},
		take(after) {
			const writes = pending;
			pending = [];
			let read: readonly Change[] | null = null;
			return () => (read ??= changesOf(writes, after));
		}
	};
}

// ── Internal ─────────────────────────────────────────────────────────────────

/** One write: its changes where it said what it changed, and the span they cover, old to new. */
interface Capture {
	changes: Change[] | null;
	lo: number;
	oldHi: number;
	/** Null where the write couldn't say: its span runs to the end of the text it left. */
	newHi: number | null;
}

function capture(
	runs: readonly TopLevelChange[] | null,
	before: BlockBytes | null,
	doc: DocumentView,
	was: { prefix: string; suffix: string }
): Capture {
	if (!before) return { changes: [], lo: 0, oldHi: 0, newHi: 0 };
	const start = (i: number) => was.prefix.length + sumTo(before, i);
	if (!runs || was.prefix !== doc.prefix || was.suffix !== doc.suffix) {
		const oldHi = start(before.lengths.length) + was.suffix.length;
		return { changes: null, lo: 0, oldHi, newHi: null };
	}
	const tops = doc.children;
	const changes: Change[] = [];
	let grown = 0;
	for (const run of runs) {
		const at = run.at + grown;
		grown += run.inserted - run.removed;
		const insert = piecesOf(tops, at, at + run.inserted).join('');
		changes.push({ from: start(run.at), to: start(run.at + run.removed), insert });
	}
	// The last block, which any write may rewrite, where no run took it.
	const last = before.lengths.length - 1;
	if (last >= 0 && !runs.some((run) => last >= run.at && last < run.at + run.removed)) {
		let now = last;
		for (const run of runs) if (run.at + run.removed <= last) now += run.inserted - run.removed;
		const insert = piecesOf(tops, now, now + 1).join('');
		if (insert !== before.pieces[2 * last] + before.pieces[2 * last + 1]) {
			changes.push({ from: start(last), to: start(last + 1), insert });
		}
	}
	changes.sort((a, b) => a.from - b.from);
	if (changes.length === 0) return { changes, lo: 0, oldHi: 0, newHi: 0 };
	const lo = changes[0].from;
	const oldHi = changes[changes.length - 1].to;
	const grew = changes.reduce((sum, c) => sum + c.insert.length - (c.to - c.from), 0);
	return { changes, lo, oldHi, newHi: oldHi + grew };
}

/** The bytes of blocks `[0, index)`, from the sums the record keeps, extended as far as asked. */
function sumTo(record: BlockBytes, index: number): number {
	const { lengths, sums } = record;
	for (let i = record.summed; i < index; i++) sums[i] = (i > 0 ? sums[i - 1] : 0) + lengths[i];
	record.summed = Math.max(record.summed, index);
	return index > 0 ? sums[index - 1] : 0;
}

/** The writes' changes: one write's own, or one change over the span they cover together. */
function changesOf(writes: readonly Capture[], after: () => string): readonly Change[] {
	// A write that couldn't say and wasn't the edit's own (a load) starts the document over.
	let from = 0;
	for (let i = 0; i < writes.length - 1; i++) if (!writes[i].changes) from = i + 1;
	const own = writes.slice(from);
	if (own.length === 1 && own[0].changes) return own[0].changes;
	if (own.length === 0) return [];
	const text = after();
	// Each span maps the one before through it: outside both, a byte moves by what each grew.
	let { lo, oldHi } = own[0];
	let newHi = own[0].newHi ?? text.length;
	for (const next of own.slice(1)) {
		const nextHi = next.newHi ?? text.length;
		const midHi = Math.max(newHi, next.oldHi);
		oldHi = midHi - (newHi - oldHi);
		newHi = midHi + (nextHi - next.oldHi);
		lo = Math.min(lo, next.lo);
	}
	return [{ from: lo, to: oldHi, insert: text.slice(lo, newHi) }];
}
