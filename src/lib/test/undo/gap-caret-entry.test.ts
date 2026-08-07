// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { placeGapCaret } from '$lib/selection/caret-doors';
import { isGapSelection } from '$lib/undo/types';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';

// What an undo entry records when the caret is in a gap. Every block is mounted here and
// reports no cursor (jsdom seats no native caret), so the gap must beat the DECLARED
// fallback coordinate, not merely an absence of refs.

const TABLE_THEN_FENCE = '| a |\n| - |\n\n```\nx\n```\n';
const AT_BOUNDARY = { parentPath: [], index: 1 };

function harness() {
	const h = makeEditorActionsDeps(parse(TABLE_THEN_FENCE).children);
	const controller = createUndoController(h.deps);
	return { ...h, controller, actions: createBlockEditActions(h.deps, controller) };
}

describe('an undo entry pushed while a gap is live records the gap', () => {
	it('the mint stores the boundary it was minted at, not its snapshot coordinate', async () => {
		const h = harness();
		placeGapCaret(h.deps.selectionState, AT_BOUNDARY);

		await h.actions.insertParagraph(1, 'x');

		const entry = h.deps.undoManager.getStacks().undo.at(-1)!;
		expect(isGapSelection(entry.selection)).toBe(true);
		expect(entry.selection).toEqual({ gapCaret: AT_BOUNDARY });
	});

	it('captureCurrentState carries it too, so the redo side of a swap keeps the gap', () => {
		const h = harness();
		placeGapCaret(h.deps.selectionState, AT_BOUNDARY);

		expect(h.controller.captureCurrentState().selection).toEqual({ gapCaret: AT_BOUNDARY });
	});

	// Non-vacuity: the same commit with no gap live still takes the declared coordinate.
	it('falls back to the declared coordinate when no gap is live', async () => {
		const h = harness();

		await h.actions.insertParagraph(1, 'x');

		const entry = h.deps.undoManager.getStacks().undo.at(-1)!;
		expect(isGapSelection(entry.selection)).toBe(false);
		expect(entry.selection).toEqual({
			anchor: { path: [1], offset: 0 },
			focus: { path: [1], offset: 0 }
		});
	});

	// The entry names a boundary in the PRE-mutation tree: undoing the mint must find the
	// document that boundary was eligible in.
	it('names a boundary that resolves in its own snapshot', async () => {
		const h = harness();
		placeGapCaret(h.deps.selectionState, AT_BOUNDARY);

		await h.actions.insertParagraph(1, 'x');

		const entry = h.deps.undoManager.getStacks().undo.at(-1)!;
		expect(entry.snapshot.children).toHaveLength(2);
		expect(h.deps.doc.children).toHaveLength(3);
	});
});
