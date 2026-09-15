/**
 * The fallbacks for a merge that did not happen, in both directions: the sibling merge
 * (`block-edit-core`) and the list-item merge (`unwrap-strategies.listItemCascadeMiddle`).
 * A refused merge still moves the caret across the boundary the user pressed at.
 */

import { CURSOR_END, CURSOR_START, type BlockComponent } from '../block-component';
import type { StructuralChange } from '../tree-operations/structural-change';

/**
 * A null result means the previous block had no reachable text leaf, or the join was
 * refused, so nothing merged: put the caret at its end instead. The nullable input makes
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
 * The forward counterpart, over the commit's own change: `noop` means the join was refused
 * (the joined bytes parse as several blocks, and one slot holds one node), so the caret
 * crosses into the block that stayed. Returns whether the merge happened.
 */
export function mergedElseFocusNext(
	change: StructuralChange,
	next: BlockComponent | undefined
): boolean {
	if (change.op !== 'noop') return true;
	next?.focus(CURSOR_START);
	return false;
}
