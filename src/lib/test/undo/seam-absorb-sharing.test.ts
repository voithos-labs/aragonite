import { describe, it, expect } from 'vitest';
import { takeDevWarns } from '../support/warn-gate';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { createUndoController } from '../../editor-actions/commit/undo-controller';
import { createHistoryActions } from '../../editor-actions/commit/history';
import { createBlockEditActions } from '../../editor-actions/block-edit';
import { createReorderAction } from '../../editor-actions/reorder-action';
import { makeEditorActionsDeps } from '../harness/editor-actions';

// Absorbing at the join between two blocks splices a range whose first node is an existing
// neighbour, so while an undo snapshot is outstanding the collapse reaches nodes that entry
// still shares: the G1.9 case every earlier test missed by starting from a fresh sharing state.
// Miss-analysis: those tests all built their own `createSharingState()`, so the splice never
// took its copy-before-write branch and the integrity check never saw these paths.

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

describe('a seam absorb under an outstanding snapshot', () => {
	it('leaves the demotion fold’s shared predecessor byte-identical, and undo restores it', async () => {
		const h = harness();
		h.controller.pushUndoSnapshot(1, 0);

		await h.actions.updateBlockContent(1, 'x# h\n', 0, 1);

		expect(h.doc.children).toHaveLength(1);
		expect(h.snapshotBytes()).toBe(TIGHT_JOIN);

		await h.history.requestUndo();

		expect(takeDevWarns()).toEqual([]);
		expect(serialize(h.doc)).toBe(TIGHT_JOIN);
		expect(h.doc.children.map((c) => c.kind)).toEqual(['paragraph', 'heading', 'paragraph']);
	});

	it('leaves the reorder fold’s shared window byte-identical, and undo restores it', async () => {
		const h = harness();
		h.controller.pushUndoSnapshot(1, 0);

		await h.reorder.moveReorderUnit([1], 2);

		expect(h.doc.children).toHaveLength(2);
		expect(h.snapshotBytes()).toBe(TIGHT_JOIN);

		await h.history.requestUndo();

		expect(takeDevWarns()).toEqual([]);
		expect(serialize(h.doc)).toBe(TIGHT_JOIN);
		expect(h.doc.children.map((c) => c.kind)).toEqual(['paragraph', 'heading', 'paragraph']);
	});

	// GH #255: the collapse splices out the underline the entry still shares, and changes the
	// first block's kind beyond what its own bytes say.
	// Miss-analysis: no test of splitting put a structural line that only matters in combination
	// under the second half, so the collapse that changes the first block's kind never ran while
	// an undo entry was outstanding.
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
