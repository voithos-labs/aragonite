// @vitest-environment jsdom
// Miss-analysis: only the gap caret had a test; none recorded an entry with an image selected.
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import type { EditorSelection } from '#lib/selection/primitives.js';
import { asDocPath } from '#lib/selection/path-math.js';
import { selectWidgetWhole } from '#lib/selection/caret-doors.js';
import { makeEditorActionsDeps, stubBlockComponent } from '#lib/test/harness/editor-actions.js';

// What an undo entry records while an image is selected whole, when the user's caret is the one
// from before the selection and no block's report can be trusted.

const PARAGRAPHS = 'abc ![c](x.png) tail\n\nsecond\n';
const BESIDE_IMAGE: EditorSelection = {
	anchor: { path: [0], offset: 15 },
	focus: { path: [0], offset: 15 }
};

/** With `imageSelected`, the image is selected as a click on its trailing edge leaves it. */
function harness(imageSelected: boolean) {
	const h = makeEditorActionsDeps(parse(PARAGRAPHS));
	if (imageSelected) {
		selectWidgetWhole(h.deps.selectionState, {
			paragraphPath: [0],
			sourceStart: 4,
			preSelectOffset: BESIDE_IMAGE.focus.offset
		});
	}
	return { ...h, controller: createUndoController(h.deps) };
}

/** A commit that writes nothing new still records the entry, declaring `offset` in block [1]. */
function commitAt(h: ReturnType<typeof harness>, offset: number): Promise<boolean> {
	return h.controller.commitStructural({
		snapshot: { path: asDocPath([1]), offset },
		mutate: () => ({ op: 'noop' }),
		touchedNodes: []
	});
}

describe('an undo entry recorded while an image is selected', () => {
	it('captureCurrentState stores the caret from before the selection, not the document start', () => {
		const h = harness(true);

		expect(h.controller.captureCurrentState().selection).toEqual(BESIDE_IMAGE);
	});

	it('a commit declaring its own coordinate stores the selected image caret instead', async () => {
		const h = harness(true);

		await commitAt(h, 0);

		expect(h.deps.undoManager.getStacks().undo.at(-1)!.selection).toEqual(BESIDE_IMAGE);
	});

	// The browser puts back a caret at the paragraph start on the next input, and the key that
	// records the entry runs before the editor drops it.
	it('outranks a caret the paragraph reports while its image is selected', () => {
		const h = harness(true);
		h.deps.blockRefs[0] = stubBlockComponent({ getCursorOffset: () => 0 });

		expect(h.controller.captureCurrentState().selection).toEqual(BESIDE_IMAGE);
	});

	it('leaves a live caret to answer when no image is selected', () => {
		const h = harness(false);
		h.deps.blockRefs[1] = stubBlockComponent({ getCursorOffset: () => 4 });

		expect(h.controller.captureCurrentState().selection).toEqual({
			anchor: { path: [1], offset: 4 },
			focus: { path: [1], offset: 4 }
		});
	});

	it('falls back to the declared coordinate when no image is selected', async () => {
		const h = harness(false);

		await commitAt(h, 2);

		expect(h.deps.undoManager.getStacks().undo.at(-1)!.selection).toEqual({
			anchor: { path: [1], offset: 2 },
			focus: { path: [1], offset: 2 }
		});
	});
});
