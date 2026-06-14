import { describe, it, expect } from 'vitest';
import { createUndoController } from '$lib/editor/editor-actions/undo-controller';
import { makeBlockListState, makeEditorActionsDeps } from '$lib/editor/test/harness/editor-actions';

function makeContainerNode(childRaws: string[]): any {
	return {
		kind: 'list',
		leadingTrivia: '',
		raw: childRaws.join(''),
		children: childRaws.map((r) => ({ kind: 'listItem', leadingTrivia: '', raw: r }))
	};
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('commit ceremony — rollback on mutation throw', () => {
	it('rolls the undo stack back and emits error when a commit mutation throws', async () => {
		const { deps, events } = makeEditorActionsDeps([makeContainerNode(['- a\n', '- b\n'])]);
		const state = makeBlockListState(() => deps.doc.children[0], ['id-a', 'id-b']);
		const controller = createUndoController(deps);

		const errors: { origin: string }[] = [];
		events.on('error', (e) => errors.push({ origin: e.origin }));

		const before = deps.undoManager.getStacks().undo.length;
		await expect(
			controller.commitMultiScope({
				scopes: [{ node: deps.doc.children[0], state, path: [0] }],
				snapshot: { blockIndex: 0, offset: 0 },
				mutate: () => {
					throw new Error('boom');
				}
			})
		).rejects.toThrow('boom'); // DEV re-throw preserved

		expect(deps.undoManager.getStacks().undo.length).toBe(before); // rolled back (was before+1 before the fix)
		expect(errors).toHaveLength(1);
		expect(errors[0].origin).toBe('commit');
	});
});
