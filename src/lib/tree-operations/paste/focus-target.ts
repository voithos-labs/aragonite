/**
 * The caret a `[prefix?, ...pasted, residue?]` replacement lands, on both sides of the separator
 * fix-up: which node the paste aims at, the position the fix-up's merges keep updated for it,
 * and the offset the caret can actually sit at there.
 */

import { CURSOR_END } from '../../block-component';
import type { CstNode } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { trimTrailingLineEnding } from '../../core/lines';
import { tryGetBlockKindDescriptor } from '../../schema/block-kind-descriptor';
import type { TrackedPosition } from '../settle';

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
 * The offset the caret can sit at, given {@link trackedPasteCaret}'s updated position. Only a
 * known leaf uses the tracked byte: a container walks any numeric offset to its last child, so
 * its raw offsets address no caret position. Anything the caller named itself stands as given.
 */
export function landedPasteOffset(
	landed: NodeView | undefined,
	tracked: TrackedPosition,
	focusOffset: number
): number {
	if (focusOffset !== CURSOR_END) return focusOffset;
	const leaf = landed && tryGetBlockKindDescriptor(landed.kind)?.isContainer === false;
	return leaf ? tracked.offset : CURSOR_END;
}
