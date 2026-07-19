/**
 * Single owner of the interior-merge no-target fallback, shared by the
 * cross-sibling merge (`block-edit-core.mergeWithPreviousInterior`) and the
 * within-list M1 merge (`unwrap-strategies.listItemCascadeMiddle`).
 */

import { CURSOR_END, type BlockComponent } from '../block-component';

/**
 * A null merge result means the previous block/item exposed no reachable text
 * leaf (its deepest leaf is opaque — a fenced code block, a collapsed
 * container's chrome), so nothing merged. Land the caret at the previous
 * block's end, whose own `focus(CURSOR_END)` resolves to its deepest leaf (or a
 * collapsed summary); return the result so a caller places the merged caret.
 * The nullable input makes ignoring the no-target case a compile error.
 */
export function mergedElseFocusPrevious<T>(
	result: T | null,
	previous: BlockComponent | undefined
): T | null {
	if (result === null) previous?.focus(CURSOR_END);
	return result;
}
