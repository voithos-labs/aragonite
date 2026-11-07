/**
 * G1.190: what a write tells the open drafts holds everything it changed. A write names the
 * top-level blocks it may reach and records only those, so one that reached past them would leave
 * a draft mapping its ranges over bytes that moved.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';

/** A run of the document's parts, each part two pieces. */
interface PartRun {
	readonly lo: number;
	readonly before: readonly unknown[];
}

/** `whole` is the change read over every part, `recorded` the one read over the write's reach. */
export function checkChangeInReach(
	whole: PartRun | null,
	recorded: PartRun | null
): InvariantViolation | null {
	if (!whole) return null;
	const end = (run: PartRun) => run.lo + run.before.length / 2;
	if (recorded && whole.lo >= recorded.lo && end(whole) <= end(recorded)) return null;
	return {
		code: 'change-record',
		message: `a write changed parts ${whole.lo} to ${end(whole)}, past the reach it recorded`
	};
}

/** At a draft's commit: each range no recorded write touched still holds the bytes it opened on. */
export function checkDraftBytesKept(
	opened: string,
	now: string,
	ranges: readonly { was: { from: number; to: number }; is: { from: number; to: number } }[]
): InvariantViolation | null {
	for (const { was, is } of ranges) {
		if (opened.slice(was.from, was.to) === now.slice(is.from, is.to)) continue;
		return {
			code: 'change-record',
			message: `bytes ${was.from} to ${was.to} changed under a draft with no write recorded`
		};
	}
	return null;
}
