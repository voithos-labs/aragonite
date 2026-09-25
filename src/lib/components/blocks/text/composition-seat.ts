/**
 * What an IME composition needs remembered, captured at `compositionstart`. The arrival side and
 * the pending marks both belong to the caret the composition opened at, and by the time the
 * composed run arrives the arrival side has been overwritten, so they are captured up front.
 */

import type { InlineNode } from '../../../core/nodes';
import type { VisibilityContext } from '../../../core/inline/visibility';
import type { EdgeAffinity } from '../../../cursor/edge-affinity';
import type { Reading } from '../../../schema/reading';
import type { InlineMarkKind } from '../../../schema/inline-construct-policy';
import { plainInsertionAt, relocateComposedRun } from './edge-seat';
import { resolveMarkedInsertion } from './pending-mark-insert';

export interface CompositionSeatDeps {
	/** The block's displayed text, which a commit's reading is compared against. */
	getDisplayText: () => string;
	getInlines: () => readonly InlineNode[];
	/** The reading `getInlines` reads with, so a candidate keeps the reference links it shows and
	 *  reads back as the syntax the editor draws. */
	reading: Reading;
	getAffinity: () => EdgeAffinity | null;
	/** How the block reads on screen, for deciding which ranges are actually drawn. */
	getScreen: () => VisibilityContext;
	/** Spend the pending marks: a composition is the one insertion they were promised to. */
	consumePendingMarks: () => ReadonlySet<InlineMarkKind> | null;
	/** Give them back when the composition wrote nothing: a cancelled IME run inserts nothing, so
	 *  the marks are still pending. Required, so every block answers the same way. */
	restorePendingMarks: (marks: ReadonlySet<InlineMarkKind>) => void;
	/** The block's selection, read at `compositionstart`: composing over one is a range edit none of
	 *  the plain insertion paths take, so it goes to `resolveRangeEdit`. Omit to keep ranges as the
	 *  browser wrote them. */
	getRawSelection?: () => { start: number; end: number } | null;
	/** How this block resolves a range replace, in displayed bytes; null keeps the browser's own
	 *  edit, the same refusal the keydown selection-edit path makes. */
	resolveRangeEdit?: (
		range: { start: number; end: number },
		typed: string
	) => { raw: string; caret: number } | null;
}

export interface CompositionSeat {
	/** Capture the state the composition opened in. Call it before the block's own
	 *  `compositionstart`, whose cross-block half clears the arrival side, and before the first
	 *  `input` during the composition, which resets that side to the typed one. */
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
	/** Whether a commit asked for bytes. The answer given does not matter: a run arrived either
	 *  way, and that run is the insertion the marks were promised to. */
	committed: boolean;
}

export function createCompositionSeat(deps: CompositionSeatDeps): CompositionSeat {
	// One nullable capture rather than a stack: a composition runs from `compositionstart` to the
	// single commit `compositionend` drives.
	let started: CompositionWindow | null = null;

	return {
		noteStart: () => {
			started = {
				before: deps.getDisplayText(),
				affinity: deps.getAffinity(),
				marks: deps.consumePendingMarks(),
				range: deps.getRawSelection?.() ?? null,
				committed: false
			};
		},
		relocate: (after, composedAt) => {
			if (started === null) return null;
			started.committed = true;
			// A selection open when the composition started makes this a range replace: the plain
			// paths below cannot take it, and the browser's literal replace strands the delimiter
			// runs the range crossed.
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
								deps.getInlines(),
								deps.reading
							);
				if (marked) return marked;
			}
			return relocateComposedRun(
				started.before,
				after,
				composedAt,
				deps.getInlines(),
				started.affinity,
				deps.getScreen(),
				deps.reading
			);
		},
		noteEnd: () => {
			if (started && !started.committed && started.marks) {
				deps.restorePendingMarks(started.marks);
			}
			started = null;
		}
	};
}

/** The run the commit's reading put over `range`, or null when that reading is not a replacement
 *  of exactly that span: nothing here can tell what the browser did, so verbatim is honest. */
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
