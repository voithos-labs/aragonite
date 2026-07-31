import type { ClosureBlock } from '$lib/schema/closure';

/**
 * A closure block that clears G1.24's coherence check for any throwaway test kind,
 * whatever its mergeRole/contract/chrome: `roundTrip: implemented` clears the
 * container rule, `mergeBackspace: not-supported` the not-mergeable rule, and
 * `clipboard: implemented` the reservedChrome rule. Real kinds author honest blocks.
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
