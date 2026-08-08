/**
 * One composition's worth of seat inputs. An IME's `insertCompositionText` beforeinput is not
 * cancelable, so a composed run cannot be intercepted at the keystroke the way a typed byte
 * is: it is relocated once, on the commit `compositionend` drives. Both inputs the relocation
 * needs — the arrival side and the pending marks — belong to the caret the composition OPENED
 * at, and the commit's own affinity re-arm has spent them by the time the run arrives, so the
 * window is captured here at `compositionstart`.
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
				marks: deps.consumePendingMarks()
			};
		},
		relocate: (after, composedAt) => {
			if (started === null) return null;
			// Marks beat the arrival side (§ 4.2): a toggle is the newer instruction about the
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
