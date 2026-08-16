// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeStubBlockEdit
} from '$lib/test/harness/editor-actions';

// GH #121: the container-match, sibling-absorb and break-out strategies never read `preDelete`, so
// a paste over a selection kept the selected bytes as the residue its split hands the trailing
// half. The cut is spent ONCE at the door now, ahead of a strategy pick that decides on the
// target's bytes.
// Miss-analysis: every container-route case pastes at a COLLAPSED caret, so the field these routes
// ignore was populated in none of them; the hook routes' own `preDelete` pins hid the gap.

function harnessFor(source: string) {
	const { deps } = makeEditorActionsDeps(parse(source));
	registerBlockListState(
		deps.doc.children[0],
		makeBlockListState(() => deps.doc.children[0])
	);
	const controller = createUndoController(deps);
	return { deps, coordinator: createPasteCoordinator(controller, deps.revealPath) };
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
			{ doc: deps.doc, blockEdit: makeStubBlockEdit(), controller: coordinator, undoEntry: 'own' }
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
			{ doc: deps.doc, blockEdit: makeStubBlockEdit(), controller: coordinator, undoEntry: 'own' }
		);

		expect(serialize(deps.doc)).toBe('- x\n- beta\n');
	});
});
