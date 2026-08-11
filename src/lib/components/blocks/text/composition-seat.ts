/**
 * One composition's worth of seat inputs, captured at `compositionstart`. Both inputs the commit's
 * relocation needs — the arrival side and the pending marks — belong to the caret the composition
 * OPENED at, and the affinity re-arm has spent them by the time the composed run arrives.
 */

import type { InlineNode } from '../../../core/nodes';
import type { EdgeAffinity } from '../../../cursor/edge-affinity';
import type { InlineMarkKind } from '../../../cursor/pending-marks';
import { plainInsertionAt, relocateComposedRun } from './edge-seat';
import { resolveMarkedInsertion } from './pending-mark-insert';

export interface CompositionSeatDeps {
	/** The block's display bytes — what a commit's read is compared against. */
	getDisplayText: () => string;
	getInlines: () => readonly InlineNode[];
	getAffinity: () => EdgeAffinity | null;
	/** Spend the pending marks: a composition is the one insertion they were promised to. */
	consumePendingMarks: () => ReadonlySet<InlineMarkKind> | null;
	/** The block's live selection, read at compositionstart: composing over one is a range op no
	 *  plain-insertion arm claims, so it routes to `resolveRangeEdit`. Omit to keep ranges verbatim. */
	getRawSelection?: () => { start: number; end: number } | null;
	/** The surface's join-seam resolution for a range replace, in display bytes; null keeps the
	 *  engine's own edit — the same decline contract as the keydown selection-edit arm. */
	resolveRangeEdit?: (
		range: { start: number; end: number },
		typed: string
	) => { raw: string; caret: number } | null;
}

export interface CompositionSeat {
	/** Capture the window the composition opened in. Call BEFORE the surface's own
	 *  `compositionstart`, whose cross-block half clears the affinity, and before the first
	 *  mid-composition `input`, which re-arms it to the typed side. */
	noteStart(): void;
	/** The bytes the commit should write, or null to keep the DOM read verbatim. */
	relocate(after: string, composedAt: number): { raw: string; caret: number } | null;
	noteEnd(): void;
}

interface CompositionWindow {
	before: string;
	affinity: EdgeAffinity | null;
	marks: ReadonlySet<InlineMarkKind> | null;
	range: { start: number; end: number } | null;
}

export function createCompositionSeat(deps: CompositionSeatDeps): CompositionSeat {
	// A single nullable capture rather than a stack: the window is compositionstart → the one
	// commit compositionend drives.
	let started: CompositionWindow | null = null;

	return {
		noteStart: () => {
			started = {
				before: deps.getDisplayText(),
				affinity: deps.getAffinity(),
				marks: deps.consumePendingMarks(),
				range: deps.getRawSelection?.() ?? null
			};
		},
		relocate: (after, composedAt) => {
			if (started === null) return null;
			// A selection at the window's open makes this a range replace: the plain arms below
			// cannot claim it, and the engine's literal replace strands the runs the range crossed.
			if (started.range && started.range.start < started.range.end) {
				const typed = replacedRangeInsertion(started.before, after, started.range);
				if (typed === null) return null;
				return deps.resolveRangeEdit?.(started.range, typed) ?? null;
			}
			// Marks beat the arrival side (live-mode.md § 4.2): a toggle is the newer instruction about the
			// same bytes, so the affinity only answers when nothing was pending.
			if (started.marks) {
				const composed = plainInsertionAt(started.before, after, composedAt);
				const marked =
					composed === null
						? null
						: resolveMarkedInsertion(
								started.before,
								composedAt,
								composed,
								started.marks,
								deps.getInlines()
							);
				if (marked) return marked;
			}
			return relocateComposedRun(
				started.before,
				after,
				composedAt,
				deps.getInlines(),
				started.affinity
			);
		},
		noteEnd: () => {
			started = null;
		}
	};
}

/** The run the commit's read put over `range`, or null when the read is not a replacement of
 *  exactly that span — then nothing here knows what the engine did, and verbatim is honest. */
function replacedRangeInsertion(
	before: string,
	after: string,
	range: { start: number; end: number }
): string | null {
	const length = after.length - before.length + (range.end - range.start);
	if (length < 0 || range.end > before.length) return null;
	if (after.slice(0, range.start) !== before.slice(0, range.start)) return null;
	if (after.slice(range.start + length) !== before.slice(range.end)) return null;
	return after.slice(range.start, range.start + length);
}
