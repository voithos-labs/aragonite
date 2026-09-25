// @vitest-environment jsdom
// Miss-analysis: the gap caret had its own arm and test here, but no test recorded an entry while
// an image was selected, the other state in which no block reports a caret.
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import type { EditorSelection } from '$lib/selection/primitives';
import { makeEditorActionsDeps, stubBlockComponent } from '$lib/test/harness/editor-actions';

// What an undo entry records while an image is selected whole, when the user's caret is the one
// from before the selection and no block's report can be trusted.

const PARAGRAPHS = 'abc ![c](x.png) tail\n\nsecond\n';
const BESIDE_IMAGE: EditorSelection = {
	anchor: { path: [0], offset: 15 },
	focus: { path: [0], offset: 15 }
};

function harness(widgetCaret: EditorSelection | null) {
	const h = makeEditorActionsDeps(parse(PARAGRAPHS));
	h.deps.getSelectedWidgetCaret = () => widgetCaret;
	return { ...h, controller: createUndoController(h.deps) };
}

describe('an undo entry recorded while an image is selected', () => {
	it('captureCurrentState stores the caret from before the selection, not the document start', () => {
		const h = harness(BESIDE_IMAGE);

		expect(h.controller.captureCurrentState().selection).toEqual(BESIDE_IMAGE);
	});

	it('a commit declaring its own coordinate stores the selected image caret instead', () => {
		const h = harness(BESIDE_IMAGE);

		h.controller.pushUndoSnapshotPath([1], 0);

		expect(h.deps.undoManager.getStacks().undo.at(-1)!.selection).toEqual(BESIDE_IMAGE);
	});

	// The browser puts back a caret at the paragraph start on the next input, and the key that
	// records the entry runs before the editor drops it.
	it('outranks a caret the paragraph reports while its image is selected', () => {
		const h = harness(BESIDE_IMAGE);
		h.deps.blockRefs[0] = stubBlockComponent({ getCursorOffset: () => 0 });

		expect(h.controller.captureCurrentState().selection).toEqual(BESIDE_IMAGE);
	});

	it('leaves a live caret to answer when no image is selected', () => {
		const h = harness(null);
		h.deps.blockRefs[1] = stubBlockComponent({ getCursorOffset: () => 4 });

		expect(h.controller.captureCurrentState().selection).toEqual({
			anchor: { path: [1], offset: 4 },
			focus: { path: [1], offset: 4 }
		});
	});

	it('falls back to the declared coordinate when no image is selected', () => {
		const h = harness(null);

		h.controller.pushUndoSnapshotPath([1], 2);

		expect(h.deps.undoManager.getStacks().undo.at(-1)!.selection).toEqual({
			anchor: { path: [1], offset: 2 },
			focus: { path: [1], offset: 2 }
		});
	});
});
