// The content version is the memo key every whole-document derivation hangs on, so a door that
// moves the document's bytes without announcing it silently serves stale answers. One case per
// door (G4.52): the commit ceremony, the two out-of-ceremony typing writers, the history restore.
//
// Miss-analysis: the suite this replaces drove five DIRECT `$state` writes and never a door, so it
// proved the touch walk's read set and nothing about who reaches it. Every write the editor
// actually makes arrives through one of the doors below, and none of them was exercised.
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { createHistoryActions } from '$lib/editor-actions/commit/history';
import { makeEditorActionsDeps, makeNestedHarness } from '../harness/editor-actions';

function topLevelEditor(source: string) {
	const harness = makeEditorActionsDeps(parse(source));
	const controller = createUndoController(harness.deps);
	return {
		...harness,
		blockEdit: createBlockEditActions(harness.deps, controller),
		history: createHistoryActions(harness.deps, controller)
	};
}

describe('content version — every byte-writing door announces its write', () => {
	it('the commit ceremony announces a structural commit', async () => {
		const editor = topLevelEditor('one\n\ntwo\n');
		const before = editor.contentVersion();
		await editor.blockEdit.splitBlock(0, 1);
		expect(editor.doc.children.length).toBe(3);
		expect(editor.contentVersion()).not.toBe(before);
	});

	// The common keystroke: `updateNodeContent` writes the leaf's raw in place and reports
	// `noop`, so a bump placed after the change-shaped early return never fires while typing.
	it('the top-level routine-typing write announces a keystroke that changes no structure', async () => {
		const editor = topLevelEditor('one\n');
		const before = editor.contentVersion();
		await editor.blockEdit.updateBlockContent(0, 'onex\n', 3, 4);
		expect(editor.doc.children[0].raw).toBe('onex\n');
		expect(editor.contentVersion()).not.toBe(before);
	});

	it('the nested out-of-ceremony write announces a keystroke inside a container', async () => {
		const harness = makeNestedHarness('> quoted\n', { index: 0 });
		const before = harness.contentVersion();
		await harness.bundle.blockEdit.updateBlockContent(0, 'quotedx\n', 6, 7);
		expect(harness.getNode().children?.[0].raw).toBe('quotedx\n');
		expect(harness.contentVersion()).not.toBe(before);
	});

	it('the history restore announces the tree it swapped in, both directions', async () => {
		const editor = topLevelEditor('one\n\ntwo\n');
		await editor.blockEdit.deleteBlock(1);
		const afterEdit = editor.contentVersion();
		await editor.history.requestUndo();
		expect(editor.doc.children.length).toBe(2);
		expect(editor.contentVersion()).not.toBe(afterEdit);

		const afterUndo = editor.contentVersion();
		await editor.history.requestRedo();
		expect(editor.doc.children.length).toBe(1);
		expect(editor.contentVersion()).not.toBe(afterUndo);
	});

	// A discarded commit rolls its own mutation back, so announcing it would claim bytes that
	// never moved — and the rebound Backspace this discards is a routine gesture.
	it('a commit that discards its own no-op announces nothing', async () => {
		const editor = topLevelEditor('one\n');
		const before = editor.contentVersion();
		await editor.blockEdit.mergeWithPrevious(0);
		expect(editor.contentVersion()).toBe(before);
	});
});
