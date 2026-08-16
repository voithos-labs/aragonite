import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { createContainerEditActions } from '$lib/editor-actions/container-edit';
import { createStandardNestedActions } from '$lib/editor-actions/nested/nested-actions';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeNestedActionsDeps,
	makeStubBlockEdit,
	makeStubFocus
} from '$lib/test/harness/editor-actions';
import { describeConvergence } from '$lib/test/harness/parse-converged';

// The door B-F1's settle opens: routine typing writes OUTSIDE the commit ceremony, so a settle
// that folds there splices the scope with no descriptor to publish. The parallel id array is what
// keyed rendering reads, and a length it never regains is permanent.
// Miss-analysis: every fold case runs through the ceremony, where the returned change resyncs the
// arrays; the routine path was pinned for bytes only, because before the fill arm settled it could
// not splice at all.

/** A list above a blank line: filling that line with indented prose makes the list absorb it. */
const SOURCE = '- a\n\n\nzz\n';

describe('a routine content write whose settle folds', () => {
	it('publishes the fold at the document scope', async () => {
		const h = makeEditorActionsDeps(parse(SOURCE));
		const controller = createUndoController(h.deps);
		const actions = createBlockEditActions(h.deps, controller);
		const before = h.getBlockIds();

		await actions.updateBlockContent(1, '  b\n', 0);

		expect(serialize(h.deps.doc)).toBe('- a\n\n  b\n\nzz\n');
		expect(describeConvergence(h.deps.doc)).toBeNull();
		expect(h.getBlockIds()).toHaveLength(h.deps.doc.children.length);
		// The follower the fold did not eat keeps its identity.
		expect(h.getBlockIds()[1]).toBe(before[2]);
	});

	it('publishes the fold at a container scope', async () => {
		const h = makeEditorActionsDeps(parse('> - a\n>\n>\n> zz\n'));
		const controller = createUndoController(h.deps);
		const containerEdit = createContainerEditActions(h.deps, controller);
		const getNode = () => h.deps.doc.children[0];
		const state = makeBlockListState(getNode);
		registerBlockListState(getNode(), state);
		const bundle = createStandardNestedActions(
			state,
			makeNestedActionsDeps({
				index: 0,
				getNode,
				path: [0],
				parent: { blockEdit: makeStubBlockEdit(), focus: makeStubFocus(), containerEdit }
			})
		);
		const before = [...state.innerBlockIds];

		await bundle.blockEdit.updateBlockContent(1, '  b\n', 0);

		expect(serialize(h.deps.doc)).toBe('> - a\n>\n>   b\n>\n> zz\n');
		expect(describeConvergence(h.deps.doc)).toBeNull();
		expect(state.innerBlockIds).toHaveLength(getNode().children!.length);
		expect(state.innerBlockIds[1]).toBe(before[2]);
	});
});
