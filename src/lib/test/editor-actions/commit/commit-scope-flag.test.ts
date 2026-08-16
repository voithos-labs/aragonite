import { describe, it, expect } from 'vitest';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { asDocPath } from '$lib/selection/path-math';
import { createFocusActions } from '$lib/editor-actions/focus/focus';
import { beginCommit, endCommit, isCommitInProgress } from '$lib/invariants/commit-scope';
import { makeEditorActionsDeps, makeNode } from '$lib/test/harness/editor-actions';
import {
	stampStructuralChange,
	type StructuralChange
} from '$lib/tree-operations/structural-change';

// The ceremony brackets its synchronous body with this DEV flag so the decoration
// engine can assert no source re-runs inside a half-applied commit.
describe('commit-scope flag', () => {
	it('tracks an explicit begin/end pair (confirming the mechanism is live under DEV)', () => {
		expect(isCommitInProgress()).toBe(false);
		beginCommit();
		try {
			expect(isCommitInProgress()).toBe(true);
		} finally {
			endCommit();
		}
		expect(isCommitInProgress()).toBe(false);
	});

	it('clears again once a real commit ceremony resolves — the flag never leaks past the sync body', async () => {
		const { deps, doc } = makeEditorActionsDeps([
			{ kind: 'paragraph', leadingTrivia: '\n', raw: 'hello\n' } as never
		]);
		const controller = createUndoController(deps);
		const focus = createFocusActions(deps, controller);

		expect(isCommitInProgress()).toBe(false);
		await focus.moveFocus(doc.children.length, 'start');
		expect(doc.children).toHaveLength(2);
		expect(isCommitInProgress()).toBe(false);
	});

	// Pins the arm itself: the cases above stay green if `beginCommit()` is removed,
	// since neither observes the flag mid-ceremony.
	it('arms the flag for the whole of a real commit mutate callback', async () => {
		const { deps, doc } = makeEditorActionsDeps([makeNode('paragraph', 'hello\n')]);
		const controller = createUndoController(deps);

		let flagInsideMutate: boolean | null = null;
		await controller.commitStructural({
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: (children) => {
				flagInsideMutate = isCommitInProgress();
				// Separated: two trivia-less paragraphs reload as one, which the settle converges.
				children.push({ ...makeNode('paragraph', 'world\n'), leadingTrivia: '\n' });
				const change: StructuralChange = { op: 'insert', at: children.length - 1, count: 1 };
				stampStructuralChange(children, change, deps.sharing);
				return change;
			}
		});

		expect(flagInsideMutate).toBe(true);
		expect(doc.children).toHaveLength(2);
		expect(isCommitInProgress()).toBe(false);
	});
});
