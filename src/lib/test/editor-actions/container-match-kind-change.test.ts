// @vitest-environment jsdom
// A container-matching paste whose first item completes another kind's syntax in the target item
// changes that block's kind, as the same join does anywhere else.
// Miss-analysis: every container-match merge joined plain text, so the bare write that kept the
// target's kind never met bytes that read as another one.
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { pasteDispatch } from '#lib/tree-operations/paste/dispatch.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createPasteCoordinator } from '#lib/editor-actions/paste-coordinator.js';
import { registerBlockListState } from '#lib/reactivity/state-registry.js';
import { assignChildIdsDeep } from '#lib/block-id.js';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeStubBlockEdit,
	pasteContext
} from '#lib/test/harness/editor-actions.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';

describe('a container-matching merge that completes a code fence', () => {
	it.each([
		['with a second item', '- `a\n', 1, '- ``\n- z\n', '- ```\n- za\n'],
		['alone', '- `a\n', 1, '- ``\n', '- ```a\n'],
		['under a line it splits off', '- a\n  `b\n', 3, '- ``\n- z\n', '- a\n  ```\n- zb\n']
	])('%s: the target block follows its bytes', async (_name, source, offset, pasted, after) => {
		const { deps } = makeEditorActionsDeps(parse(source));
		const list = deps.doc.children[0];
		// A mounted item holds ids for its children, which a kind change has to keep in step.
		assignChildIdsDeep(list);
		registerBlockListState(
			list,
			makeBlockListState(() => deps.doc.children[0])
		);
		const coordinator = createPasteCoordinator(deps, createUndoController(deps));

		await pasteDispatch(
			{ pastedText: pasted, targetPath: [0, 0, 0], offset },
			pasteContext({
				doc: deps.doc,
				blockEdit: makeStubBlockEdit(),
				controller: coordinator,
				crossBlock: true
			})
		);

		expect(serialize(deps.doc)).toBe(after);
		expect(describeConvergence(deps.doc)).toBeNull();
		const item = deps.doc.children[0].children![0];
		expect(item.childIds).toHaveLength(item.children!.length);
	});
});
