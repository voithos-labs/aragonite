import { isGapSelection, type UndoEntry } from '$lib/undo/types';
import type { EditorSelection } from '$lib/selection/primitives';

/**
 * The anchor/focus arm of an entry's selection union, for suites asserting on a range they
 * pushed themselves. Throws on a gap entry rather than degrade, so a suite that starts seeing
 * one says so instead of asserting past it.
 */
export function rangeSelectionOf(entry: UndoEntry): EditorSelection {
	if (isGapSelection(entry.selection)) {
		throw new Error('rangeSelectionOf: entry carries a gap caret, not an anchor/focus range');
	}
	return entry.selection;
}
