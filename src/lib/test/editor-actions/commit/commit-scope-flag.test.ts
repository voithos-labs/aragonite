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

// The commit brackets its synchronous body with the commit scope so the decorations never read
// a half-applied tree.
describe('commit scope', () => {
	it('tracks an explicit begin/end pair', () => {
		expect(isCommitInProgress()).toBe(false);
		beginCommit();
		try {
			expect(isCommitInProgress()).toBe(true);
		} finally {
			endCommit();
		}
		expect(isCommitInProgress()).toBe(false);
	});

	it('closes again once a real commit sequence resolves: the scope never leaks past the sync body', async () => {
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

	// Tests the bracket itself: the cases above stay green if `beginCommit()` is removed,
	// since neither observes the scope mid-commit.
	it('holds the scope open for the whole of a real commit mutate callback', async () => {
		const { deps, doc } = makeEditorActionsDeps([makeNode('paragraph', 'hello\n')]);
		const controller = createUndoController(deps);

		let scopeOpenInsideMutate: boolean | null = null;
		await controller.commitStructural({
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: (children) => {
				scopeOpenInsideMutate = isCommitInProgress();
				// Separated: two paragraphs with no blank line reload as one, which the fix-up would merge.
				children.push({ ...makeNode('paragraph', 'world\n'), leadingTrivia: '\n' });
				const change: StructuralChange = { op: 'insert', at: children.length - 1, count: 1 };
				stampStructuralChange(children, change, deps.sharing);
				return change;
			}
		});

		expect(scopeOpenInsideMutate).toBe(true);
		expect(doc.children).toHaveLength(2);
		expect(isCommitInProgress()).toBe(false);
	});

	// Miss-analysis: every case above ran one commit at a time, so none reached a second commit
	// started from the `edit` handler the first one emits into (GH #292).
	it('keeps the scope open after a commit nested in an edit handler, until the outer one ends', async () => {
		const { deps, doc } = makeEditorActionsDeps([makeNode('paragraph', 'hello\n')]);
		const controller = createUndoController(deps);
		const appendParagraph = (text: string): Parameters<typeof controller.commitStructural>[0] => ({
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: (children) => {
				children.push({ ...makeNode('paragraph', `${text}\n`), leadingTrivia: '\n' });
				const change: StructuralChange = { op: 'insert', at: children.length - 1, count: 1 };
				stampStructuralChange(children, change, deps.sharing);
				return change;
			},
			op: { kind: 'insertBlock', eventPath: asDocPath([1]) }
		});

		let nested: Promise<void> | null = null;
		let handled = false;
		let scopeOpenAfterNestedCommit: boolean | null = null;
		deps.events.on('edit', () => {
			// The nested commit emits `edit` too, before its promise is even returned.
			if (handled) return;
			handled = true;
			// Not awaited: the nested commit's synchronous half runs inside the outer commit.
			nested = controller.commitStructural(appendParagraph('nested'));
			scopeOpenAfterNestedCommit = isCommitInProgress();
		});

		await controller.commitStructural(appendParagraph('outer'));
		await nested;

		expect(doc.children).toHaveLength(3);
		expect(scopeOpenAfterNestedCommit).toBe(true);
		expect(isCommitInProgress()).toBe(false);
	});
});
