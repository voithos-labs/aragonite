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
 * Focus index for the replacement: the last pasted node. Defined once so every structural route
 * skips the reattached residue identically. Applies only where the residue is a separate node;
 * a route that reattaches it inside the last pasted leaf lands at a char offset in a different
 * coordinate space.
 */
export function focusIndexBeforeResidue(replacementLength: number, hasResidue: boolean): number {
	return hasResidue && replacementLength >= 2 ? replacementLength - 2 : replacementLength - 1;
}

/**
 * The position the fix-up must keep updated: the end of the pasted bytes, as an index into the
 * list. `CURSOR_END` resolves to the node's own display end here: the sentinel value handed to
 * the tracker would clamp to whatever a merge reattached behind it, which is the bug it exists
 * to prevent.
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
 * Where the caret sits, given {@link trackedPasteCaret}'s updated position: the leaf inside the
 * landed block holding the tracked byte, as a path below that block and an offset in the leaf.
 * Anything the caller named itself stands as given, and a block whose bytes map to no leaf
 * (a table) takes the caret at its end.
 */
export function landedPastePosition(
	landed: NodeView | undefined,
	tracked: TrackedPosition,
	focusOffset: number
): LeafPosition {
	if (focusOffset !== CURSOR_END) return { path: [], offset: focusOffset };
	return (landed && leafAtRawOffset(landed, tracked.offset)) ?? { path: [], offset: CURSOR_END };
}
