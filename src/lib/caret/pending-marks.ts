/**
 * Pending marks: the inline formats a toggle at a collapsed caret promises the next insertion,
 * relative to the constructs around the caret (a kind already active is a removal, one absent is
 * an application). Live mode paints no delimiter, so writing an empty pair into the bytes would
 * leave an invisible `****` behind on an abandoned toggle. The toggle command sets them, the typing
 * and composition paths consume them, and the caret memory drops them (live-mode.md § 4.3).
 */

import type { InlineMarkKind } from '../schema/inline-construct-policy';

export interface PendingMarks {
	/** Null when nothing is pending; never an empty set, so a read is the whole question. */
	get(): ReadonlySet<InlineMarkKind> | null;

	/** A toggle chord at a collapsed caret. The same chord twice pends nothing again. */
	toggle(kind: InlineMarkKind): void;

	/** Read and clear: exactly one insertion spends the set. */
	consume(): ReadonlySet<InlineMarkKind> | null;

	/** Hand back a set taken for an insertion that never happened (an IME cancel). Declines once
	 *  anything else is pending: that is a newer instruction about the same caret. */
	restore(marks: ReadonlySet<InlineMarkKind>): void;
}

/** The set one toggle chord produces, or null once it empties. Pure, so the toggle matrix is
 *  testable without an instance. */
export function flipMark(
	marks: ReadonlySet<InlineMarkKind> | null,
	kind: InlineMarkKind
): ReadonlySet<InlineMarkKind> | null {
	const next = new Set(marks ?? []);
	if (!next.delete(kind)) next.add(kind);
	return next.size > 0 ? next : null;
}
