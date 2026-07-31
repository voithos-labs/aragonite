/**
 * Single owner of the interior-merge no-target fallback, shared by the
 * cross-sibling merge (`block-edit-core.mergeWithPreviousInterior`) and the
 * within-list M1 merge (`unwrap-strategies.listItemCascadeMiddle`).
 */

import { CURSOR_END, type BlockComponent } from '../block-component';

/**
 * A null result means the previous block exposed no reachable text leaf, so nothing
 * merged: land the caret at its end instead. The nullable input makes ignoring the
 * no-target case a compile error.
 */
export function mergedElseFocusPrevious<T>(
	result: T | null,
	previous: BlockComponent | undefined
): T | null {
	if (result === null) previous?.focus(CURSOR_END);
	return result;
}
