import { expect } from 'vitest';
import { isGapSelection, type UndoEntry } from '#lib/undo/types.js';
import type { EditorSelection, SelectionPoint } from '#lib/selection/primitives.js';
import type { MountedEditor } from '#lib/test/harness/mount-editor.svelte.js';

/**
 * The anchor/focus branch of an entry's selection union, for suites asserting on a range they
 * pushed themselves. Throws on a gap entry rather than degrade, so a suite that starts seeing one
 * says so instead of asserting past it.
 */
export function rangeSelectionOf(entry: UndoEntry): EditorSelection {
	if (isGapSelection(entry.selection)) {
		throw new Error('rangeSelectionOf: entry carries a gap caret, not an anchor/focus range');
	}
	return entry.selection;
}

/** The caret the newest undo entry of a mounted editor puts back; it must be a collapsed one. */
export function newestEntryCaret(editor: MountedEditor): SelectionPoint {
	const { undo } = (
		editor.instance as unknown as { __test: { getUndoStack(): { undo: UndoEntry[] } } }
	).__test.getUndoStack();
	expect(undo.length, 'no undo entry was pushed').toBeGreaterThan(0);
	const { anchor, focus } = rangeSelectionOf(undo[undo.length - 1]);
	expect(focus, 'the entry holds a range, not a caret').toEqual(anchor);
	return anchor;
}
