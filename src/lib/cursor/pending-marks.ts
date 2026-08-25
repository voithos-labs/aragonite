/**
 * Pending marks: the inline constructs a collapsed-caret toggle promises the NEXT insertion,
 * relative to the caret's construct chain — a kind already in the chain is a removal, one absent
 * is an application. Live mode paints no delimiter, so materializing an empty pair in the bytes
 * would leave invisible `****` behind on an abandoned toggle. SET by the toggle command, CONSUMED
 * by the typing and composition seats, INVALIDATED by the edge affinity (live-mode.md § 4.3).
 */

import type { InlineMarkKind } from '../schema/inline-construct-policy';

export interface PendingMarksState {
	/** Null when nothing is pending; never an empty set, so a read is the whole question. */
	get(): ReadonlySet<InlineMarkKind> | null;

	/** A toggle chord at a collapsed caret. The same chord twice pends nothing again. */
	toggle(kind: InlineMarkKind): void;

	/** Read and clear: exactly one insertion spends the set. */
	consume(): ReadonlySet<InlineMarkKind> | null;

	/** Hand back a set taken for an insertion that never happened (an IME cancel). Declines once
	 *  anything else is pending: that is a newer instruction about the same caret. */
	restore(marks: ReadonlySet<InlineMarkKind>): void;

	reset(): void;
}

export function createPendingMarksState(): PendingMarksState {
	let marks: ReadonlySet<InlineMarkKind> | null = null;

	return {
		get: () => marks,
		toggle: (kind) => {
			marks = flipMark(marks, kind);
		},
		consume: () => {
			const spent = marks;
			marks = null;
			return spent;
		},
		restore: (unspent) => {
			if (marks === null) marks = unspent;
		},
		reset: () => {
			marks = null;
		}
	};
}

/** The set a chord press produces, or null once it empties. Pure, so the toggle matrix is
 *  testable without an instance. */
export function flipMark(
	marks: ReadonlySet<InlineMarkKind> | null,
	kind: InlineMarkKind
): ReadonlySet<InlineMarkKind> | null {
	const next = new Set(marks ?? []);
	if (!next.delete(kind)) next.add(kind);
	return next.size > 0 ? next : null;
}
