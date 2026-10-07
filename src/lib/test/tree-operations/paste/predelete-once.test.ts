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

// Dispatch cuts a selection once, before picking a strategy, so no route keeps the cut bytes.
// Miss-analysis: GH #121, every container-route case pasted at a collapsed caret.

function harnessFor(source: string) {
	const { deps } = makeEditorActionsDeps(parse(source));
	registerBlockListState(
		deps.doc.children[0],
		makeBlockListState(() => deps.doc.children[0])
	);
	const controller = createUndoController(deps);
	return { deps, coordinator: createPasteCoordinator(deps, controller) };
}

describe('a paste over a selection inside a list item', () => {
	it('spends the delete half before the strategy reads the target', async () => {
		const { deps, coordinator } = harnessFor('- alpha\n');

		await pasteDispatch(
			{
				pastedText: '- x\n- y\n',
				targetPath: [0, 0, 0],
				offset: 0,
				preDelete: { start: 0, end: 'alpha'.length }
			},
			pasteContext({
				doc: deps.doc,
				blockEdit: makeStubBlockEdit(),
				controller: coordinator
			})
		);

		expect(serialize(deps.doc)).toBe('- x\n- y\n');
	});

	// The partial case: only the selected bytes go, and the rest survives around the paste.
	it('keeps the bytes outside the selection', async () => {
		const { deps, coordinator } = harnessFor('- alpha beta\n');

		await pasteDispatch(
			{
				pastedText: '- x\n',
				targetPath: [0, 0, 0],
				offset: 0,
				preDelete: { start: 0, end: 'alpha '.length }
			},
			pasteContext({
				doc: deps.doc,
				blockEdit: makeStubBlockEdit(),
				controller: coordinator
			})
		);

		expect(serialize(deps.doc)).toBe('- x\n- beta\n');
	});
});
