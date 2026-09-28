/**
 * Where the caret goes after a merge that may not have happened, in both directions: the sibling
 * merge (`block-edit-core`) and the list-item merge (`unwrap-strategies.listItemCascadeMiddle`).
 * A refused merge still moves the caret across the boundary the user pressed at.
 */

import { CURSOR_END, CURSOR_START } from '../block-component';
import type { CaretPosition } from '../selection/primitives';
import type { StructuralChange } from '../tree-operations/structural-change';

/** Null means nothing merged (no reachable text leaf, or a refused join), so the caret goes to
 *  the previous block's end. */
export function mergedElsePrevious(
	joined: CaretPosition | null,
	previous: CaretPosition['path']
): CaretPosition {
	return joined ?? { path: previous, offset: CURSOR_END };
}

/** A `noop` change means the join was refused (the joined bytes parse as several blocks), so the
 *  caret crosses into the next block's start. */
export function mergedElseNext(
	change: StructuralChange,
	joined: CaretPosition,
	next: CaretPosition['path']
): CaretPosition {
	return change.op !== 'noop' ? joined : { path: next, offset: CURSOR_START };
}
