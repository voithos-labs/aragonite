import type { ClosureBlock } from '$lib/schema/closure';

/**
 * A coherent closure block for throwaway test kinds. `closure` is required on
 * every registration, and the flush's G1.24 coherence check sweeps test kinds
 * too, so a fixture needs cells that satisfy both cross-checks regardless of its
 * mergeRole/contract: `roundTrip: implemented` clears the container rule, and
 * `mergeBackspace: not-supported` clears the not-mergeable rule. Real kinds
 * author honest blocks — this is only for kinds that exist to exercise a seam.
 */
export const testClosure: ClosureBlock = {
	roundTrip: { mode: 'implemented', via: 'test fixture' },
	focus: { mode: 'inherit-default' },
	mergeBackspace: { mode: 'not-supported', reason: 'test fixture' },
	selectionPaint: { mode: 'inherit-default' },
	searchPaint: { mode: 'inherit-default' },
	reorder: { mode: 'inherit-default' },
	undo: { mode: 'inherit-default' },
	clipboard: { mode: 'inherit-default' },
	simOracle: { mode: 'inherit-default' }
};
