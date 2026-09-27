/**
 * The fallbacks for a merge that did not happen, in both directions: the sibling merge
 * (`block-edit-core`) and the list-item merge (`unwrap-strategies.listItemCascadeMiddle`).
 * A refused merge still moves the caret across the boundary the user pressed at.
 */

import { CURSOR_END, CURSOR_START, type BlockComponent } from '../block-component';
import type { StructuralChange } from '../tree-operations/structural-change';

/** Null means nothing merged (no reachable text leaf, or a refused join), so the caret goes to
 *  the previous block's end. Taking the nullable result makes skipping that case a type error. */
export function mergedElseFocusPrevious<T>(
	result: T | null,
	previous: BlockComponent | undefined
): T | null {
	if (result === null) previous?.focus(CURSOR_END);
	return result;
}

/** A `noop` change means the join was refused (the joined bytes parse as several blocks), so
 *  the caret crosses into the next block. Returns whether the merge happened. */
export function mergedElseFocusNext(
	change: StructuralChange,
	next: BlockComponent | undefined
): boolean {
	if (change.op !== 'noop') return true;
	next?.focus(CURSOR_START);
	return false;
}
