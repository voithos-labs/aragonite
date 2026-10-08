// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { pasteDispatch } from '#lib/tree-operations/paste/dispatch.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createPasteCoordinator } from '#lib/editor-actions/paste-coordinator.js';
import { registerBlockListState } from '#lib/reactivity/state-registry.js';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeStubBlockEdit,
	pasteContext
} from '#lib/test/harness/editor-actions.js';

// The paste merge must apply the change `updateNodeContent` returns when it reattaches the tail.
// Miss-analysis: the reattach was tested on bytes and kinds, never on the item's ids or the caret.

describe('the container-matching merge spends its residue settle', () => {
	it('keeps the pasted item’s ids in step and lands the caret through the settle', async () => {
		const { deps, landings } = makeEditorActionsDeps(parse('- ```js\n  code\n  ```\n'));
		registerBlockListState(
			deps.doc.children[0],
			makeBlockListState(() => deps.doc.children[0])
		);
		const controller = createUndoController(deps);
		const coordinator = createPasteCoordinator(deps, controller);

		// Caret after `code`, so the text after it is the fence's own closing line: the reattach
		// reparses into two blocks inside the last pasted item.
		await pasteDispatch(
			{ pastedText: '- one\n- two\n', targetPath: [0, 0, 0], offset: 10 },
			pasteContext({
				doc: deps.doc,
				blockEdit: makeStubBlockEdit(),
				controller: coordinator,
				crossBlock: true
			})
		);

		const lastItem = deps.doc.children[0].children![1];
		expect(lastItem.children!.map((c) => c.kind)).toEqual(['paragraph', 'fencedCode']);
		expect(lastItem.childIds).toHaveLength(lastItem.children!.length);
		expect(serialize(deps.doc)).toBe('- ```js\n  codeone\n  ```\n- two\n  ```\n');
		// The pasted text ends inside the first block of the reattached pair, which is where the
		// fix-up reports it, not an index the paste assumed before the reparse.
		expect(landings).toMatchObject([{ leafPath: [0, 1, 0], offset: 'two'.length }]);
	});
});
