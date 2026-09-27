import type { ClosureBlock } from '$lib/schema/closure';

/**
 * A closure block that clears the closure coherence check (G1.24) for any throwaway test kind,
 * whatever its merge role, container contract or title child: `roundTrip: implemented` clears the
 * container rule, `mergeBackspace: not-supported` the not-mergeable rule, and
 * `clipboard: implemented` the `reservedChrome` rule. Real kinds write honest blocks.
 */
export const testClosure: ClosureBlock = {
	roundTrip: { mode: 'implemented', via: 'test fixture' },
	focus: { mode: 'inherit-default' },
	mergeBackspace: { mode: 'not-supported', reason: 'test fixture' },
	selectionPaint: { mode: 'inherit-default' },
	searchPaint: { mode: 'inherit-default' },
	reorder: { mode: 'inherit-default' },
	undo: { mode: 'inherit-default' },
	clipboard: { mode: 'implemented', via: 'test fixture' },
	simOracle: { mode: 'inherit-default' }
};
