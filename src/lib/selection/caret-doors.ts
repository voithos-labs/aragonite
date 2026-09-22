/**
 * The two ways a block component places the caret. `parkCaret` puts the caret down and touches
 * nothing else, which the cross-block dispatcher needs while a shift-extend is still growing a
 * range. `focus` does the same after first ending any cross-block range or gap caret: a caret
 * left inside a live range makes the next keystroke replace the whole range.
 */

import type { GapCaretPosition } from './gap-caret';
import { clearNativeSelection } from './native-bridge';
import type { SelectionState } from './selection-state.svelte';

/**
 * Builds a component's public `focus` from its `parkCaret`. Batched because `clear()` notifies
 * listeners, and a notification between the state write and the DOM caret would report a
 * caret that is about to move. The announcement at the end is what makes a placement reach
 * subscribers at the placement rather than on the browser's later `selectionchange`.
 */
export function placeCaret(
	selection: SelectionState,
	parkCaret: (offset: number) => void
): (offset: number) => void {
	return (offset) =>
		selection.batch(() => {
			endLiveCaretClaim(selection);
			parkCaret(offset);
			// A caret that was already a plain one moves no field the state checks, so nothing
			// above notifies and this is the only word subscribers get. Announced as a placement,
			// so a `focus` that lands where the caret already is says nothing.
			selection.announcePlacement();
		});
}

/**
 * The only place gap-caret state is written. The native selection is cleared inside the batch
 * because no browser caret may outlive the gap caret: the gap owns the caret until something
 * else takes it.
 */
export function placeGapCaret(selection: SelectionState, pos: GapCaretPosition): void {
	selection.batch(() => {
		endLiveCaretClaim(selection);
		selection.setGapCaret(pos);
		clearNativeSelection();
	});
}

/**
 * Ends the editor-owned caret (a cross-block range or a gap caret) before a new one lands.
 * `clear()` drops the gap caret too, so the branch is on which one is live. The native clear
 * matters for a whole-block caret, which sets no DOM range of its own.
 */
function endLiveCaretClaim(selection: SelectionState): void {
	if (selection.isCrossBlock) {
		selection.clear();
		clearNativeSelection();
		return;
	}
	selection.clearGapCaret();
}
