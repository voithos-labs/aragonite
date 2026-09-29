/**
 * Where a caret, a gap caret or a widget selected whole is put down, each ending whatever the
 * editor had selected before: a caret left inside a live range makes the next keystroke replace
 * the whole range. A block's `parkCaret` alone ends nothing, which the cross-block dispatcher
 * needs while a shift-extend is still growing a range.
 */

import { assertInvariant } from '../assert';
import { checkPlacementEndsWidget } from '../invariants/placement-ends-widget';
import type { GapCaretPosition } from './gap-caret';
import { clearNativeSelection } from './native-bridge';
import type { WidgetTarget } from './primitives';
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
			assertInvariant('placement-ends-widget', () => checkPlacementEndsWidget(selection.widget));
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

/** The only place a widget is selected whole. The native selection is cleared in the batch,
 *  because no browser caret may outlive the widget selection taking its place. */
export function selectWidgetWhole(selection: SelectionState, target: WidgetTarget): void {
	selection.batch(() => {
		selection.selectWidget(target);
		clearNativeSelection();
	});
}

/** Ends whatever the editor had selected (a range, a gap caret, a widget) before a new caret
 *  lands. The native clear covers a whole-block range, which sets no DOM range of its own. */
function endLiveCaretClaim(selection: SelectionState): void {
	const hadRange = selection.isCrossBlock;
	if (hadRange || selection.gapCaret !== null || selection.widget !== null) selection.clear();
	if (hadRange) clearNativeSelection();
}
