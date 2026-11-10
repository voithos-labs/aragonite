/**
 * The editor's own record of where its top-level blocks start, kept across writes: each write says
 * which blocks it changed, and only those are measured again. A write that can't say forgets the
 * record, and the next question measures every block once. Nothing is measured until a position is
 * asked for, so a document nobody asks about pays nothing. The record answers for the live document
 * between two announcements. From a write's first change to the tree until it announces, the
 * record is behind the tree, so a read there is answered from a fresh measure and fails a dev build.
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

export interface KeptStarts {
	/** The live document with its starts. */
	read(): Measured;
	/** Whether a position has been asked for since the record last forgot. */
	isMeasured(): boolean;
	/** A write is about to change the tree. */
	opened(): void;
	/** The open write put the tree back as it stood. */
	abandoned(): void;
	/** The open write is done. */
	changed(runs: ChangedRuns): void;
}

/** A run wider than this forgets the record, so no write measures more than a few hundred blocks. */
const WIDEST_RUN = 512;

export function createKeptStarts(doc: () => DocumentView): KeptStarts {
	let kept: BlockLengths | null = null;
	let view: Measured | null = null;
	let open = 0;

	const misused = (message: string) =>
		assertInvariant('kept-starts-current', () => ({ code: 'kept-starts-misused', message }));
	const inWrite = () => {
		if (open > 0) misused('a position was read between a write and its announcement');
		return open > 0;
	};
	// Untracked, so a reactive reader subscribes to the content version and not to every block.
	const lengths = () =>
		kept ?? untrack(() => (inWrite() ? blockLengths(doc()) : (kept = blockLengths(doc()))));

	return {
		read: () =>
			untrack(() => {
				if (inWrite()) return measured(doc());
				if (kept && kept.lengths.length !== doc().children.length) {
					misused('the document changed its blocks with no write announced');
					kept = null;
				}
				return (view ??= { doc: doc(), starts: startsOver(doc(), lengths) });
			}),
		isMeasured: () => kept !== null,
		opened() {
			open++;
		},
		abandoned() {
			open = Math.max(open - 1, 0);
		},
		changed(runsOf) {
			if (open === 0) misused('a write announced its changes without opening first');
			// A write made inside another's leaves neither able to place its runs.
			const runs = kept && open === 1 ? runsOf?.() : null;
			open = Math.max(open - 1, 0);
			view = null;
			if (!kept) return;
			if (!runs || runs.some((run) => run.inserted > WIDEST_RUN)) {
				kept = null;
				return;
			}
			const record = kept;
			untrack(() => {
				applyChanges(doc(), record, runs);
				if (devChecksOn && !perfEnabled()) {
					assertInvariant('kept-starts-current', () =>
						checkKeptStarts(record.lengths, doc(), runs)
					);
				}
			});
		}
	};
}
