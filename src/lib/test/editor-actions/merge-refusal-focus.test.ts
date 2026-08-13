import { describe, it, expect, vi } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { CURSOR_END, CURSOR_START } from '$lib/block-component';
import { makeEditorActionsDeps, mockRef } from '$lib/test/harness/editor-actions';

// GH #166. Miss-analysis: no case drove Delete/Backspace across a boundary whose joined bytes
// read as two blocks, so the doors' behaviour there was only ever the sinks' — and both sinks
// answered wrong in silence.

/** Caret at the heading's end, Delete; caret at the paragraph's start, Backspace. */
const HEADING_OVER_TWO_LINES = '# h\ntext\nmore\n';

function makeTop(source: string) {
	const harness = makeEditorActionsDeps(parse(source));
	const controller = createUndoController(harness.deps);
	const focuses = harness.deps.doc.children.map(() => vi.fn());
	focuses.forEach((focus, i) => {
		harness.getBlockRefs()[i] = mockRef({ focus });
	});
	return {
		...harness,
		focuses,
		actions: createBlockEditActions(harness.deps, controller)
	};
}

describe('a refused join moves the caret instead of merging', () => {
	it('Delete at the heading end lands the caret in the block that stayed', async () => {
		const h = makeTop(HEADING_OVER_TWO_LINES);

		await h.actions.mergeWithNext(0);

		expect(serialize(h.deps.doc)).toBe(HEADING_OVER_TWO_LINES);
		expect(h.focuses[1]).toHaveBeenCalledWith(CURSOR_START);
		expect(h.focuses[0]).not.toHaveBeenCalled();
	});

	it('Backspace at the paragraph start lands the caret at the end of the block above', async () => {
		const h = makeTop(HEADING_OVER_TWO_LINES);

		await h.actions.mergeWithPrevious(1);

		expect(serialize(h.deps.doc)).toBe(HEADING_OVER_TWO_LINES);
		expect(h.focuses[0]).toHaveBeenCalledWith(CURSOR_END);
	});

	it('mints no undo entry for either refusal', async () => {
		const h = makeTop(HEADING_OVER_TWO_LINES);

		await h.actions.mergeWithNext(0);
		await h.actions.mergeWithPrevious(1);

		expect(h.deps.undoManager.canUndo).toBe(false);
	});

	// Non-vacuity: the ordinary join still merges and still seats the caret at the seam.
	it('an ordinary forward join still merges and lands at the seam', async () => {
		const h = makeTop('alpha\n\nbeta\n');

		await h.actions.mergeWithNext(0);

		expect(serialize(h.deps.doc)).toBe('alphabeta\n');
		expect(h.focuses[0]).toHaveBeenCalledWith(5);
	});
});
