import { describe, it, expect } from 'vitest';
import { takeDevWarns } from '../support/warn-gate';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { createUndoController } from '../../editor-actions/commit/undo-controller';
import { createHistoryActions } from '../../editor-actions/commit/history';
import { createBlockEditActions } from '../../editor-actions/block-edit';
import { createReorderAction } from '../../editor-actions/reorder-action';
import { makeEditorActionsDeps } from '../harness/editor-actions';

// A seam absorb splices a window whose HEAD is a pre-existing neighbour, so under an outstanding
// snapshot the fold reaches nodes an entry still shares — the G1.9 case every earlier absorb pin
// missed by starting from a fresh sharing state.
// Miss-analysis: the fold pins all built their own `createSharingState()`, so the copy-on-write
// branch of the splice was never taken and the integrity oracle never saw these paths.

const TIGHT_JOIN = 'a\n# h\nb\n';

function harness() {
	const { deps, doc } = makeEditorActionsDeps(parse(TIGHT_JOIN));
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
});
