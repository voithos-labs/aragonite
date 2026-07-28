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

// The commit ceremony brackets its synchronous body with this DEV flag so the
// decoration engine can assert no source re-runs inside a half-applied commit.
// The live behavior is otherwise only exercised by the simulation suite.
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
		await focus.moveFocus(doc.children.length, 'start'); // appends a block → a real __commit
		expect(doc.children).toHaveLength(2); // the commit actually ran
		expect(isCommitInProgress()).toBe(false); // finally-cleared before the first await
	});

	// The pair above proves the flag mechanism and that the ceremony leaves it
	// clear — but neither observes it ARMED mid-ceremony, so removing beginCommit()
	// from the commit helper leaves both green. This pins the arm itself: the flag
	// is true inside a mutate driven through the real commit entry point, which is
	// exactly the window the decoration-run-in-commit assert guards.
	it('arms the flag for the whole of a real commit mutate callback', async () => {
		const { deps, doc } = makeEditorActionsDeps([makeNode('paragraph', 'hello\n')]);
		const controller = createUndoController(deps);

		let flagInsideMutate: boolean | null = null;
		await controller.commitStructural({
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: (children) => {
				flagInsideMutate = isCommitInProgress();
				children.push(makeNode('paragraph', 'world\n'));
				const change: StructuralChange = { op: 'insert', at: children.length - 1, count: 1 };
				stampStructuralChange(children, change, deps.sharing);
				return change;
			}
		});

		expect(flagInsideMutate).toBe(true); // armed while the mutation ran
		expect(doc.children).toHaveLength(2); // and the commit actually applied
		expect(isCommitInProgress()).toBe(false); // then cleared
	});
});
