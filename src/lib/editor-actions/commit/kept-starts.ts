/**
 * The editor's own record of where its top-level blocks start, kept across writes: each write says
 * which blocks it changed, and only those are measured again. A write that can't say forgets the
 * record, and the next read measures every block once. The record answers for the live document
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

export interface KeptStarts {
	/** The live document with its starts. */
	read(): Measured;
	/** Whether a read has measured the document since the record last forgot: a write names its
	 *  blocks only then, so a document nobody reads pays nothing for the record. */
	isMeasured(): boolean;
	/** A write is about to change the tree. */
	opened(): void;
	/** The open write put the tree back as it stood. */
	abandoned(): void;
	/** The open write is done. `changes` are the runs of blocks it changed, in document order; null
	 *  when it can't say. */
	changed(changes: readonly TopLevelChange[] | null): void;
}

/** A run wider than this forgets the record, so no write measures more than a few hundred blocks. */
const WIDEST_RUN = 512;

export function createKeptStarts(doc: () => DocumentView): KeptStarts {
	let kept: BlockLengths | null = null;
	let view: Measured | null = null;
	let open = 0;
	// A write made inside another's leaves neither able to place its runs.
	let nested = false;

	const misused = (message: string) =>
		assertInvariant('kept-starts-current', () => ({ code: 'kept-starts-misused', message }));

	function close(): void {
		open = Math.max(open - 1, 0);
		if (open === 0) nested = false;
	}

	return {
		// Untracked, so a reactive reader subscribes to the content version and not to every block.
		read: () =>
			untrack(() => {
				if (open > 0) {
					misused('a position was read between a write and its announcement');
					return measured(doc());
				}
				if (!view) {
					kept ??= blockLengths(doc());
					view = { doc: doc(), starts: startsOver(doc(), kept) };
				}
				return view;
			}),
		isMeasured: () => kept !== null,
		opened() {
			if (open++ > 0) nested = true;
		},
		abandoned: close,
		changed(changes) {
			if (open === 0) misused('a write announced its changes without opening first');
			const runs = nested ? null : changes;
			close();
			view = null;
			if (!kept) return;
			if (!runs || runs.some((run) => run.inserted > WIDEST_RUN)) {
				kept = null;
				return;
			}
			const lengths = kept;
			untrack(() => {
				applyChanges(doc(), lengths, runs);
				if (devChecksOn && !perfEnabled()) {
					assertInvariant('kept-starts-current', () =>
						checkKeptStarts(lengths.lengths, doc(), placedRuns(runs))
					);
				}
			});
		}
	};
}

/** Where each run's blocks stand once every run is in. */
function placedRuns(changes: readonly TopLevelChange[]): { from: number; to: number }[] {
	let grown = 0;
	return changes.map((change) => {
		const from = change.at + grown;
		grown += change.inserted - change.removed;
		return { from, to: from + change.inserted };
	});
}
