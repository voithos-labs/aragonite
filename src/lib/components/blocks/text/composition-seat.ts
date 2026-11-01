/**
 * The selection an IME composition opened over, captured as it opens: it is gone by the time the
 * composed run arrives, and the run replaces it. A run composed at a plain caret goes to the block's
 * write, which places it and spends the caret memory's records like any insertion.
 */

import { checkLiveRangeWritten } from '../../../invariants/live-range-written';
import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';

export interface CompositionSeatDeps {
	/** The block's displayed text, which a commit's reading is compared against. */
	getDisplayText: () => string;
	/** The block's selection, read as the composition opens: composing over one goes to
	 *  `resolveRangeEdit`. Omit to keep ranges as the browser wrote them. */
	getRawSelection?: () => { start: number; end: number } | null;
	/** How this block resolves a range replace, in displayed bytes: the write a typed key over the
	 *  same selection makes. */
	resolveRangeEdit?: (
		range: { start: number; end: number },
		typed: string
	) => { raw: string; caret: number };
}

export interface CompositionSeat {
	/** Capture the selection the composition opened over. Call it as the composition opens. */
	noteStart(): void;
	/** The bytes the commit should write, or null to write the DOM read as an insertion. */
	relocate(after: string): { raw: string; caret: number } | null;
	noteEnd(): void;
}

interface CompositionWindow {
	before: string;
	range: { start: number; end: number } | null;
}

export function createCompositionSeat(deps: CompositionSeatDeps): CompositionSeat {
	// One nullable capture rather than a stack: a composition runs from its opening to the single
	// commit `compositionend` drives.
	let started: CompositionWindow | null = null;

	return {
		noteStart: () => {
			started = { before: deps.getDisplayText(), range: deps.getRawSelection?.() ?? null };
		},
		relocate: (after) => {
			// A selection open at the start makes this a range replace, which the browser would do
			// literally, stranding the delimiter runs the range crossed.
			if (!started?.range || started.range.start >= started.range.end) return null;
			const typed = replacedRangeInsertion(started.before, after, started.range);
			if (typed === null) return null;
			const edit = deps.resolveRangeEdit?.(started.range, typed) ?? null;
			assertInvariant('live-range-written', () =>
				checkLiveRangeWritten({ route: 'composition', overSelection: true, written: !!edit })
			);
			return edit;
		},
		noteEnd: () => {
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
