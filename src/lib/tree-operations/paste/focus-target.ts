/**
 * The caret a `[prefix?, ...pasted, residue?]` replacement lands, on both sides of the separator
 * fix-up: which node the paste aims at, the position the fix-up's merges keep updated for it,
 * and the leaf and offset the caret can actually sit at there.
 */

import { CURSOR_END } from '../../block-component';
import type { CstNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { trimTrailingLineEnding } from '../../core/lines';
import type { TrackedPosition } from '../settle';
import { leafAtRawOffset, type LeafPosition } from '../container-offsets';

/**
 * The last pasted node's index, shared so every structural route skips a residue node the same
 * way; a residue reattached inside the last pasted leaf is not a node and isn't counted.
 */
export function focusIndexBeforeResidue(replacementLength: number, hasResidue: boolean): number {
	return hasResidue && replacementLength >= 2 ? replacementLength - 2 : replacementLength - 1;
}

/**
 * The end of the pasted bytes, for the fix-up's merges to keep updated. `CURSOR_END` resolves to
 * the node's display end here, or the tracker would clamp it past whatever a merge reattached.
 */
export function trackedPasteCaret(
	replacement: readonly CstNode[],
	at: number,
	focusIndex: number,
	focusOffset: number
): TrackedPosition {
	const displayEnd = trimTrailingLineEnding(replacement[focusIndex]?.raw ?? '').length;
	return {
		index: at + focusIndex,
		offset: focusOffset === CURSOR_END ? displayEnd : Math.max(focusOffset, 0)
	};
}

/**
 * The leaf and offset holding the tracked byte inside the landed block. An offset the caller named
 * stands as given, and a block whose bytes map to no leaf (a table) takes the caret at its end.
 */
export function landedPastePosition(
	landed: NodeView | undefined,
	tracked: TrackedPosition,
	focusOffset: number
): LeafPosition {
	if (focusOffset !== CURSOR_END) return { path: [], offset: focusOffset };
	return (landed && leafAtRawOffset(landed, tracked.offset)) ?? { path: [], offset: CURSOR_END };
}
