import { describe, it, expect } from 'vitest';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createFocusActions } from '$lib/editor-actions/focus/focus';
import { beginCommit, endCommit, isCommitInProgress } from '$lib/invariants/commit-scope';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';

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
});
