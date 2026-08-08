import { describe, it, expect } from 'vitest';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { parse } from '$lib/core/parser';

// A command's bytes are not typing: a format toggle pressed mid-burst must be its own undo
// step, so one Ctrl+Z takes the formatting off and leaves the words. Miss-analysis: the
// undo-granularity suite only pinned STRUCTURAL commits, which interrupt through the commit
// ceremony — command-path TEXT edits share `updateBlockContent` with keystrokes and were
// assumed batched, so nothing contradicted the coalescing.

function makeEditor(source: string) {
	const { deps } = makeEditorActionsDeps(parse(source).children);
	const controller = createUndoController(deps);
	return { deps, controller, blockEdit: createBlockEditActions(deps, controller) };
}

describe('a command-path text edit owns its undo entry', () => {
	it('a toggle between two keystrokes is its own entry, not folded into the burst', async () => {
		const { deps, controller, blockEdit } = makeEditor('ab\n');

		await blockEdit.updateBlockContent(0, 'abc\n', 2);
		controller.isolateUndoEntry(() => void blockEdit.updateBlockContent(0, '**abc**\n', 3));
		await blockEdit.updateBlockContent(0, '**abcd**\n', 5);

		expect(deps.undoManager.getStacks().undo).toHaveLength(3);
		controller.flushDebouncedCheckpoint();
	});

	it('the entry below the toggle is the pre-toggle text, so one step undoes the formatting', async () => {
		const { deps, controller, blockEdit } = makeEditor('ab\n');

		await blockEdit.updateBlockContent(0, 'abc\n', 2);
		controller.isolateUndoEntry(() => void blockEdit.updateBlockContent(0, '**abc**\n', 3));

		const stacks = deps.undoManager.getStacks();
		expect(stacks.undo.at(-1)?.snapshot.children[0].raw).toBe('abc\n');
		controller.flushDebouncedCheckpoint();
	});

	// The isolation is symmetric: without the trailing break the next keystroke joins the
	// toggle's batch and one Ctrl+Z would revert the toggle AND the typing after it.
	it('typing after the toggle starts a fresh batch', async () => {
		const { deps, controller, blockEdit } = makeEditor('ab\n');

		controller.isolateUndoEntry(() => void blockEdit.updateBlockContent(0, '**ab**\n', 0));
		await blockEdit.updateBlockContent(0, '**abc**\n', 4);
		await blockEdit.updateBlockContent(0, '**abcd**\n', 5);

		expect(deps.undoManager.getStacks().undo).toHaveLength(2);
		controller.flushDebouncedCheckpoint();
	});

	// Non-vacuity: the same three writes without the seam coalesce, which is what shipped.
	it('the same writes without the seam coalesce into one entry', async () => {
		const { deps, controller, blockEdit } = makeEditor('ab\n');

		await blockEdit.updateBlockContent(0, 'abc\n', 2);
		await blockEdit.updateBlockContent(0, '**abc**\n', 3);
		await blockEdit.updateBlockContent(0, '**abcd**\n', 5);

		expect(deps.undoManager.getStacks().undo).toHaveLength(1);
		controller.flushDebouncedCheckpoint();
	});
});
