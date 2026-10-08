/**
 * Where a caret, a gap caret or a widget selected whole is put down, each ending whatever the
 * editor had selected before: a caret left inside a live range makes the next keystroke replace
 * the whole range. A block's `parkCaret` alone ends nothing, which the cross-block dispatcher
 * needs while a shift-extend is still growing a range.
 */

import { assertInvariant } from '../assert';
import { checkPlacementEndsWidget } from '../invariants/placement-ends-widget';
import type { GapCaretPosition } from './gap-caret';
import type { CaretWriter } from '../caret/widget-offset';
import type { WidgetTarget } from './primitives';
import type { SelectionState } from './selection-state.svelte';

/** Builds a component's public `focus` from its `parkCaret`, batched so no listener hears of
 *  a caret between the state write and the DOM placement. */
export function placeCaret(
	selection: SelectionState,
	writer: CaretWriter,
	parkCaret: (offset: number) => void
): (offset: number) => void {
	return (offset) => putDown(selection, writer, () => parkCaret(offset));
}

/** Puts a browser range down inside one block (a first Mod+A, a block's `setSelection`) the way
 *  `placeCaret` puts a caret down: whatever the editor had selected ends first. */
export function selectInBlock(
	selection: SelectionState,
	writer: CaretWriter,
	select: () => void
): void {
	putDown(selection, writer, select);
}

function putDown(selection: SelectionState, writer: CaretWriter, place: () => void): void {
	selection.batch(() => {
		endLiveCaretClaim(selection, writer);
		place();
		assertInvariant('placement-ends-widget', () => checkPlacementEndsWidget(selection.widget));
		// A plain caret or range changes no field the state checks, so subscribers hear of the
		// placement only here, and one that lands where the selection already was says nothing.
		selection.announcePlacement();
	});
}

/** The only place gap-caret state is written. The native selection is cleared in the batch
 *  because no browser caret may outlive the gap caret. */
export function placeGapCaret(
	selection: SelectionState,
	writer: CaretWriter,
	pos: GapCaretPosition
): void {
	selection.batch(() => {
		endLiveCaretClaim(selection, writer);
		selection.setGapCaret(pos);
		writer.clear();
	});
}

/** The only place a widget is selected whole. The native selection is cleared in the batch,
 *  because no browser caret may outlive the widget selection taking its place. */
export function selectWidgetWhole(
	selection: SelectionState,
	writer: CaretWriter,
	target: WidgetTarget
): void {
	selection.batch(() => {
		selection.selectWidget(target);
		writer.clear();
	});
}

/** Ends whatever the editor had selected (a range, a gap caret, a widget) before a new caret
 *  lands. The native clear covers a whole-block range, which sets no DOM range of its own. */
function endLiveCaretClaim(selection: SelectionState, writer: CaretWriter): void {
	const hadRange = selection.isCrossBlock;
	if (hadRange || selection.gapCaret !== null || selection.widget !== null) selection.clear();
	if (hadRange) writer.clear();
}
