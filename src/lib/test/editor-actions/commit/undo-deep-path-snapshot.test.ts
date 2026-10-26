import { describe, it, expect } from 'vitest';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { rangeSelectionOf } from '#lib/test/support/undo-entry.js';
import {
	makeEditorActionsDeps,
	stubBlockComponent,
	makeNode
} from '#lib/test/harness/editor-actions.js';
import { docPathFrom } from '#lib/caret/coordinate-spaces.js';

describe('debounced undo snapshot: deep path capture', () => {
	it('records the live deep path when a ref provides getCursorPosition', () => {
		const { deps } = makeEditorActionsDeps([makeNode('table', '| a |\n')]);
		deps.blockRefs[0] = stubBlockComponent({
			getCursorOffset: () => 5,
			getCursorPosition: () => ({ path: [0, 1], offset: 5 })
		});

		const controller = createUndoController(deps);
		void controller.typingKeystroke(
			docPathFrom([0]),
			3,
			'leaf',
			'join-typing',
			async () => undefined
		);

		const { undo } = deps.undoManager.getStacks();
		expect(undo).toHaveLength(1);
		expect(rangeSelectionOf(undo[0]).anchor.path).toEqual([0, 0, 1]);
		expect(rangeSelectionOf(undo[0]).anchor.offset).toBe(3);
		expect(rangeSelectionOf(undo[0]).focus.path).toEqual([0, 0, 1]);
		expect(rangeSelectionOf(undo[0]).focus.offset).toBe(3);
	});

	it('falls back to the passed leaf path when no ref reports a cursor', () => {
		const { deps } = makeEditorActionsDeps([makeNode('paragraph', 'hi\n')]);
		const controller = createUndoController(deps);
		void controller.typingKeystroke(
			docPathFrom([0]),
			2,
			'leaf',
			'join-typing',
			async () => undefined
		);

		const { undo } = deps.undoManager.getStacks();
		expect(undo).toHaveLength(1);
		expect(rangeSelectionOf(undo[0]).anchor.path).toEqual([0]);
		expect(rangeSelectionOf(undo[0]).anchor.offset).toBe(2);
	});

	it('flat top-level prose typing path stays flat (live ref reports [i])', () => {
		const { deps } = makeEditorActionsDeps([makeNode('paragraph', 'hello\n')]);
		deps.blockRefs[0] = stubBlockComponent({ getCursorOffset: () => 4 });

		const controller = createUndoController(deps);
		void controller.typingKeystroke(
			docPathFrom([0]),
			1,
			'leaf',
			'join-typing',
			async () => undefined
		);

		const { undo } = deps.undoManager.getStacks();
		expect(rangeSelectionOf(undo[0]).anchor.path).toEqual([0]);
		expect(rangeSelectionOf(undo[0]).anchor.offset).toBe(1);
	});
});
