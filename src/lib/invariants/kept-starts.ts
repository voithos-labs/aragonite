/**
 * G1.209: the bytes the editor keeps for its top-level blocks are the document's, two strings a
 * block. A write that named too few of the blocks it changed leaves the kept text wrong there,
 * whether or not a length moved, and a range edit would then read or cut the wrong bytes.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';
import type { DocumentView } from '../core/node-views';
import type { TopLevelChange } from '../tree-operations/top-level-starts';

/** A document up to this many blocks is compared whole. A longer one is compared by its count and
 *  by the blocks either side of each run, since a whole compare reads every block on every write. */
const WHOLE_UP_TO = 2000;

/** `runs` are what the write said it changed, each `at` counted before any of them was made. */
export function checkKeptStarts(
	kept: readonly string[],
	doc: DocumentView,
	runs: readonly TopLevelChange[]
): InvariantViolation | null {
	const tops = doc.children;
	if (kept.length !== tops.length * 2) {
		return stale(`${kept.length / 2} blocks are kept for a document of ${tops.length}`);
	}
	let grown = 0;
	const beside = runs.flatMap((run) => {
		const from = run.at + grown;
		grown += run.inserted - run.removed;
		return [from - 1, from + run.inserted];
	});
	for (const i of tops.length <= WHOLE_UP_TO ? tops.keys() : beside) {
		const top = tops[i];
		if (top && (kept[2 * i] !== top.leadingTrivia || kept[2 * i + 1] !== top.raw)) {
			return stale(`block ${i} changed its bytes and the write that changed it never named it`);
		}
	}
	return null;
}

const stale = (message: string): InvariantViolation => ({ code: 'kept-starts-stale', message });
