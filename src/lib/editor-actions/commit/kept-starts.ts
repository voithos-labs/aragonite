/**
 * The editor's own record of where its top-level blocks start, kept across writes: each write says
 * which blocks it changed, and only those are measured again. A write that can't say forgets the
 * record, and the next question measures every block once. Nothing is measured until a position is
 * asked for, so a document nobody asks about pays nothing. The record answers for the live document
 * between two announcements. From a write's first change to the tree until it announces, the
 * record is behind the tree, so a read there is answered from a fresh measure and fails a dev build.
 * `duringWrite` is the one way into that window, so no writer can leave it open or open a second.
 */

import { untrack } from 'svelte';
import { assertInvariant, devChecksOn } from '@voithos-labs/aragonite/dev-checks';
import type { DocumentView } from '../../core/node-views';
import { checkKeptStarts } from '../../invariants/kept-starts';
import { perfEnabled } from '../../perf/instruments';
import {
	applyChanges,
	blockLengths,
	measured,
	startsOver,
	type BlockLengths,
	type Measured,
	type TopLevelChange
} from '../../tree-operations/top-level-starts';

/** What a write says it changed: its runs of top-level blocks, in document order, asked only
 *  while the record is measured; null, or a null answer, when the write can't say. */
export type ChangedRuns = (() => readonly TopLevelChange[] | null) | null;

/** What a write hands back: the runs it changed, or `unchanged` when the tree stands as it did. */
export interface Written {
	touched: ChangedRuns | 'unchanged';
}

export interface KeptStarts {
	/** The document as it stands, with its starts. Read it again after a write: a pair held across
	 *  one stays true only where the write put in a new list, as the byte splice's own does. */
	read(): Measured;
	/** Whether a position has been asked for since the record last forgot. */
	isMeasured(): boolean;
	/** Whether the tree may hold bytes no announcement covers: a write is open, or one threw and
	 *  none has announced since. Whatever is kept of the document steps aside while it holds. */
	unannounced(): boolean;
	/** Whether a write is open now, from before its first change until it announces. */
	writing(): boolean;
	/** Runs one write to the tree, then announces what it touched; one opened inside another throws
	 *  first. A throw counts the tree unannounced until the next write announces. */
	duringWrite<T extends Written>(write: () => T): T;
}

/** A run wider than this forgets the record, so no write measures more than a few hundred blocks. */
const WIDEST_RUN = 512;

/** `announce` tells the editor its bytes changed (the content version), once the record has moved. */
export function createKeptStarts(doc: () => DocumentView, announce: () => void): KeptStarts {
	let kept: BlockLengths | null = null;
	let view: Measured | null = null;
	let open = false;
	let threw = false;

	const misused = (message: string) =>
		assertInvariant('kept-starts-current', () => ({ code: 'kept-starts-misused', message }));
	const unannounced = () => open || threw;
	// Nothing vouches for the rollback of a write that threw, so the record goes with it.
	const forget = () => {
		kept = view = null;
		threw = true;
	};
	/** Moves the record past a write's runs, or forgets it when the write can't say. */
	const place = (runsOf: ChangedRuns) => {
		threw = false;
		view = null;
		if (!kept) return;
		const runs = runsOf?.();
		if (!runs || runs.some((run) => run.inserted > WIDEST_RUN)) {
			kept = null;
			return;
		}
		const record = kept;
		untrack(() => {
			applyChanges(doc(), record, runs);
			if (devChecksOn && !perfEnabled()) {
				assertInvariant('kept-starts-current', () => checkKeptStarts(record.lengths, doc(), runs));
			}
		});
	};
	const inWrite = () => {
		if (devChecksOn && open) misused('a position was read between a write and its announcement');
		return unannounced();
	};
	const pinned = (): Measured => {
		const at = { ...doc() };
		let own: BlockLengths | undefined;
		const lengths = (): BlockLengths => {
			if (view === made && kept) return kept;
			// Untracked, so a reactive reader subscribes to the content version and not to every block.
			return untrack(() => {
				// A view kept past the next announcement measures its own document, once.
				if (view !== made) return (own ??= blockLengths(at));
				return inWrite() ? blockLengths(at) : (kept = blockLengths(at));
			});
		};
		const made: Measured = { doc: at, starts: startsOver(at, lengths) };
		return made;
	};

	return {
		read: () =>
			untrack(() => {
				if (inWrite()) return measured(doc());
				if (kept && kept.lengths.length !== doc().children.length) {
					if (devChecksOn) misused('the document changed its blocks with no write announced');
					kept = null;
					view = null;
				}
				return (view ??= pinned());
			}),
		isMeasured: () => kept !== null,
		unannounced,
		writing: () => open,
		duringWrite(write) {
			// The outer write would publish over the inner one's bytes (G1.211).
			if (open) throw new Error('aragonite: a write started inside another write');
			open = true;
			try {
				const written = write();
				if (written.touched !== 'unchanged') {
					place(written.touched);
					announce();
				} else {
					// The bytes stand, but the write may have left copies in the tree's slots, so
					// whatever the outgoing view cached of the list (`topsOf`) goes with it.
					view = null;
				}
				return written;
			} catch (err) {
				forget();
				throw err;
			} finally {
				open = false;
			}
		}
	};
}
