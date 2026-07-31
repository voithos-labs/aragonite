/**
 * The two caret doors a block component exposes. `parkCaret` is the primitive: it seats a caret
 * and touches nothing else, which is what the cross-block dispatcher needs while an extend is
 * still growing a range. `focus` is that primitive plus the range-ending every other placement
 * owes, since a caret left in a live cross-block range leaves a document the next keystroke
 * type-replaces. The door a caller reaches for by default is the safe one.
 */

import { clearNativeSelection } from './native-bridge';
import type { SelectionState } from './selection-state.svelte';

/**
 * Mint a component's public `focus` from its park primitive. Batched because `clear()` notifies:
 * an emission between the state write and the DOM landing reports a caret about to move.
 */
export function placeCaret(
	selection: SelectionState,
	parkCaret: (offset: number) => void
): (offset: number) => void {
	return (offset) =>
		selection.batch(() => {
			endLiveRange(selection);
			parkCaret(offset);
		});
}

/**
 * Guarded on `isCrossBlock` so the common no-range placement stays a zero-emission no-op;
 * `clear()` notifies whether or not it changed anything. The native clear matters for a
 * whole-block landing, which seats no DOM range of its own.
 */
function endLiveRange(selection: SelectionState): void {
	if (!selection.isCrossBlock) return;
	selection.clear();
	clearNativeSelection();
}
