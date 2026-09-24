// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeStubBlockEdit,
	pasteContext
} from '$lib/test/harness/editor-actions';

// The container-matching paste merge reattaches the text after the caret through
// `updateNodeContent` and threw the returned change away, so a fix-up that spliced the
// pasted item's own body left its ids unsynced and the caret on an index chosen before it ran.
// Miss-analysis: the reattach was tested on bytes and on the landed item's kinds, never on
// the item's id array or on where the fix-up put the caret; the discard is enforced by a
// predicate in a different function, so no case here could observe it.

describe('the container-matching merge spends its residue settle', () => {
	it('keeps the pasted item’s ids in step and lands the caret through the settle', async () => {
		const { deps } = makeEditorActionsDeps(parse('- ```js\n  code\n  ```\n'));
		registerBlockListState(
			deps.doc.children[0],
			makeBlockListState(() => deps.doc.children[0])
		);
		const controller = createUndoController(deps);
		const coordinator = createPasteCoordinator(controller, deps.revealPath);
		const landCaret = vi.spyOn(coordinator, 'landCaret');

		// Caret after `code`, so the text after it is the fence's own closing line: the reattach
		// reparses into two blocks inside the last pasted item.
		await pasteDispatch(
			{ pastedText: '- one\n- two\n', targetPath: [0, 0, 0], offset: 10 },
			pasteContext({
				doc: deps.doc,
				blockEdit: makeStubBlockEdit(),
				controller: coordinator,
				undoEntry: 'join'
			})
		);

		const lastItem = deps.doc.children[0].children![1];
		expect(lastItem.children!.map((c) => c.kind)).toEqual(['paragraph', 'fencedCode']);
		expect(lastItem.childIds).toHaveLength(lastItem.children!.length);
		expect(serialize(deps.doc)).toBe('- ```js\n  codeone\n  ```\n- two\n  ```\n');
		// The pasted text ends inside the first block of the reattached pair, which is where the
		// fix-up reports it, not an index the paste assumed before the reparse.
		expect(landCaret).toHaveBeenCalledWith([0, 1, 0], 'two'.length);
	});
});
