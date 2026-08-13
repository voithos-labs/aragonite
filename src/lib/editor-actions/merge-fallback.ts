/**
 * Single owner of the interior-merge fallbacks, both directions: the cross-sibling merge
 * (`block-edit-core`), the within-list M1 merge (`unwrap-strategies.listItemCascadeMiddle`).
 * A merge that does not happen still moves the caret across the boundary the user pressed at.
 */

import { CURSOR_END, CURSOR_START, type BlockComponent } from '../block-component';
import type { StructuralChange } from '../tree-operations/structural-change';

/**
 * A null result means the previous block exposed no reachable text leaf, or the join was
 * refused, so nothing merged: land the caret at its end instead. The nullable input makes
 * ignoring the no-merge case a compile error.
 */
export function mergedElseFocusPrevious<T>(
	result: T | null,
	previous: BlockComponent | undefined
): T | null {
	if (result === null) previous?.focus(CURSOR_END);
	return result;
}

/**
 * The forward twin, over the door's own change: `noop` means the join was refused (its bytes
 * read as several blocks, and one slot installs one node), so the caret crosses into the block
 * that stayed. Returns whether the merge happened, so the caller's landing asks the same question.
 */
export function mergedElseFocusNext(
	change: StructuralChange,
	next: BlockComponent | undefined
): boolean {
	if (change.op !== 'noop') return true;
	next?.focus(CURSOR_START);
	return false;
}
