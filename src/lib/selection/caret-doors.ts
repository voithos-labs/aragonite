/**
 * The two ways a block component places the caret. `parkCaret` puts the caret down and touches
 * nothing else, which the cross-block dispatcher needs while a shift-extend is still growing a
 * range. `focus` does the same after first ending any cross-block range or gap caret: a caret
 * left inside a live range makes the next keystroke replace the whole range.
 */

import type { GapCaretPosition } from './gap-caret';
import { clearNativeSelection } from './native-bridge';
import type { SelectionState } from './selection-state.svelte';

/** Builds a component's public `focus` from its `parkCaret`, batched so no listener hears of
 *  a caret between the state write and the DOM placement. */
export function placeCaret(
	selection: SelectionState,
	parkCaret: (offset: number) => void
): (offset: number) => void {
	return (offset) =>
		selection.batch(() => {
			endLiveCaretClaim(selection);
			parkCaret(offset);
			// An already plain caret changes no field the state checks, so subscribers hear of the
			// placement only here, and a `focus` where the caret already is says nothing.
			selection.announcePlacement();
		});
}

/** The only place gap-caret state is written. The native selection is cleared in the batch
 *  because no browser caret may outlive the gap caret. */
export function placeGapCaret(selection: SelectionState, pos: GapCaretPosition): void {
	selection.batch(() => {
		endLiveCaretClaim(selection);
		selection.setGapCaret(pos);
		clearNativeSelection();
	});
}

/** Ends the editor-owned caret (a cross-block range or a gap caret) before a new one lands.
 *  The native clear covers a whole-block caret, which sets no DOM range of its own. */
function endLiveCaretClaim(selection: SelectionState): void {
	if (selection.isCrossBlock) {
		selection.clear();
		clearNativeSelection();
		return;
	}
	selection.clearGapCaret();
}
