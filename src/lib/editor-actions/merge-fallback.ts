/**
 * Where the caret goes after a merge that may not have happened, in both directions: the sibling
 * merge (`block-edit-core`) and the list-item merge (`unwrap-strategies.listItemCascadeMiddle`).
 * A refused merge still moves the caret across the boundary the user pressed at, where `beside`
 * says, off the neighbour's syntax.
 */

import type { CaretPosition, Landing } from '../selection/primitives';
import type { GapCaretSelection } from '../selection/gap-caret';
import type { StructuralChange } from '../tree-operations/structural-change';

type Beside = () => Landing | GapCaretSelection | null;

/** Null means nothing merged (no reachable text leaf, or a refused join), so the caret goes to
 *  the end of what is before. */
export function mergedElsePrevious(
	joined: CaretPosition | null,
	beside: Beside
): Landing | GapCaretSelection | null {
	return joined ?? beside();
}

/** A `noop` change means the join was refused (the joined bytes parse as several blocks), so the
 *  caret crosses into the start of what is after. */
export function mergedElseNext(
	change: StructuralChange,
	joined: CaretPosition,
	beside: Beside
): Landing | GapCaretSelection | null {
	return change.op !== 'noop' ? joined : beside();
}
