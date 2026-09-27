import { describe, it, expect } from 'vitest';
import { takeDevWarns } from '../support/warn-gate';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { createUndoController } from '../../editor-actions/commit/undo-controller';
import { createHistoryActions } from '../../editor-actions/commit/history';
import { createBlockEditActions } from '../../editor-actions/block-edit';
import { createReorderAction } from '../../editor-actions/reorder-action';
import { makeEditorActionsDeps } from '../harness/editor-actions';

// Absorbing at the join between two blocks splices a range starting at an existing neighbour, so
// with an undo entry outstanding the collapse writes nodes that entry still shares (G1.9).
// Miss-analysis: every test built a fresh `createSharingState()`, so no copy-before-write ran.

const TIGHT_JOIN = 'a\n# h\nb\n';
const UNDERLINE_BELOW = '# [t](u)\n===\n\nafter\n';

function harness(source = TIGHT_JOIN) {
	const { deps, doc } = makeEditorActionsDeps(parse(source));
	const controller = createUndoController(deps);
	return {
		deps,
		doc,
		controller,
		history: createHistoryActions(deps, controller),
		actions: createBlockEditActions(deps, controller),
		reorder: createReorderAction(deps, controller),
		snapshotBytes() {
			return serialize(deps.undoManager.getStacks().undo.at(-1)!.snapshot);
		}
	};
}

describe('a join absorb under an outstanding snapshot', () => {
	it('leaves the demotion fold’s shared predecessor byte-identical, and undo restores it', async () => {
		const h = harness();
		h.deps.undoManager.push(h.controller.captureCurrentState());

		await h.actions.updateBlockContent(1, 'x# h\n', 'authored', 0, 1);

		expect(h.doc.children).toHaveLength(1);
		expect(h.snapshotBytes()).toBe(TIGHT_JOIN);

		await h.history.requestUndo();

		expect(takeDevWarns()).toEqual([]);
		expect(serialize(h.doc)).toBe(TIGHT_JOIN);
		expect(h.doc.children.map((c) => c.kind)).toEqual(['paragraph', 'heading', 'paragraph']);
	});

	it('leaves the reorder fold’s shared window byte-identical, and undo restores it', async () => {
		const h = harness();
		h.deps.undoManager.push(h.controller.captureCurrentState());

		await h.reorder.moveReorderUnit([1], 2);

		expect(h.doc.children).toHaveLength(2);
		expect(h.snapshotBytes()).toBe(TIGHT_JOIN);

		await h.history.requestUndo();

		expect(takeDevWarns()).toEqual([]);
		expect(serialize(h.doc)).toBe(TIGHT_JOIN);
		expect(h.doc.children.map((c) => c.kind)).toEqual(['paragraph', 'heading', 'paragraph']);
	});

	// The split's collapse splices out the setext underline the undo entry still shares.
	// Miss-analysis: GH #255; no split test left an underline beneath the second half's text.
	it('splices the shared underline into the promoted head, and undo restores it', async () => {
		const h = harness(UNDERLINE_BELOW);

		// Inside the heading's content: a cut at its start moves the whole heading down instead.
		await h.actions.splitBlock(0, 3);

		expect(h.doc.children.map((c) => [c.kind, c.raw])).toEqual([
			['heading', '# [\n'],
			['setextHeading', 't](u)\n===\n'],
			['paragraph', 'after\n']
		]);
		expect(h.snapshotBytes()).toBe(UNDERLINE_BELOW);

		await h.history.requestUndo();

		expect(takeDevWarns()).toEqual([]);
		expect(serialize(h.doc)).toBe(UNDERLINE_BELOW);
		expect(h.doc.children.map((c) => c.kind)).toEqual(['heading', 'paragraph', 'paragraph']);
	});
});
