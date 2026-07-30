/**
 * The two caret doors a block component exposes, and the one place their
 * difference is decided.
 *
 * `parkCaret` is the primitive: it seats a caret and touches nothing else. The
 * cross-block dispatcher needs exactly that while an extend is still growing a
 * range — `revealActiveEndpoint` parks in an endpoint it has just revealed, and a
 * range-ending there would cancel the selection the user is building.
 *
 * `focus` is that primitive plus the range-ending every other placement owes. A
 * caret placed into a live cross-block range that stays live is a document the
 * next keystroke type-replaces; two whole-document losses shipped while one verb
 * carried both meanings, which is why the door a caller reaches for by default is
 * the safe one.
 */

import { clearNativeSelection } from './native-bridge';
import type { SelectionState } from './selection-state.svelte';

/**
 * Mint a component's public `focus` from its park primitive. Batched because
 * `clear()` notifies: an emission between the state write and the DOM landing
 * reports the caret the landing is about to move (`SelectionState.batch`).
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
 * Guarded on `isCrossBlock` so the overwhelmingly common no-range placement stays
 * a zero-emission no-op — `clear()` notifies whether or not it changed anything.
 * The native clear matters for a whole-block landing, which seats no DOM range of
 * its own and would otherwise leave the old one painted.
 */
function endLiveRange(selection: SelectionState): void {
	if (!selection.isCrossBlock) return;
	selection.clear();
	clearNativeSelection();
}
