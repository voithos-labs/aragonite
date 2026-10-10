// A scope `path` that does not address its `node` must bail, not fall back to the caller's
// never-copied node: the splice would land on the node the snapshot shares and silently
// corrupt the newest undo entry, which the dev warnings don't catch in production. The
// keystroke's in-place write (`leaf-write.ts`) likewise writes nothing on a too-short path.
import { describe, it, expect } from 'vitest';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { parse } from '#lib/core/parser.js';
import { concatChildren, serialize } from '#lib/core/serializer.js';
import type { EditorError } from '#lib/editor-events.js';
import type { MultiScopeTarget } from '#lib/action-contracts.js';
import { makeBlockListState, makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { makeListItem } from '#lib/test/harness/list-fixtures.js';
import { asDocPath } from '#lib/selection/path-math.js';

function harness(scopePath: number[]) {
	const { deps, events } = makeEditorActionsDeps(parse('- a\n- b\n').children);
	const controller = createUndoController(deps);
	const state = makeBlockListState(() => deps.doc.children[0]);
	// A pushed snapshot is what makes the live node shared, so a write through it corrupts history.
	deps.undoManager.push(controller.captureCurrentState());
	const scopes: MultiScopeTarget[] = [{ node: deps.doc.children[0], state, path: scopePath }];
	const commit = (): Promise<boolean> =>
		controller.commitMultiScope({
			scopes,
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: ([scope]) => {
				scope.children.push(makeListItem('- c\n'));
				return [{ op: 'insert', at: scope.children.length - 1, count: 1 }];
			}
		});
	return { deps, events, commit };
}

describe('commitMultiScope bails on a scope path that ran off the tree', () => {
	// [99]: the whole walk misses. [0, 99]: the walk stops partway, where a fallback would
	// hand over the ancestor instead.
	for (const scopePath of [[99], [0, 99]]) {
		it(`writes nothing through the shared tree for path [${scopePath.join(',')}]`, async () => {
			const { deps, commit } = harness(scopePath);
			// The children array is the evidence, not `serialize`: a [99] walk rebuilds no raw
			// at all, so the corrupted entry is invisible to a byte compare.
			const sharedList = deps.undoManager.peekUndo()!.snapshot.children[0];
			const sharedBefore = concatChildren(sharedList.children ?? []);
			const treeBefore = serialize(deps.doc);

			await commit().catch(() => {});

			expect(concatChildren(sharedList.children ?? [])).toBe(sharedBefore);
			expect(concatChildren(deps.doc.children[0].children ?? [])).toBe(sharedBefore);
			expect(serialize(deps.doc)).toBe(treeBefore);
			expect(takeDevWarns().map((w) => w.tag)).toContain('invariant:multi-scope-scope-depth');
		});
	}

	it('reports the bail on the error path instead of failing silently', async () => {
		const { events, commit } = harness([99]);
		const errors: EditorError[] = [];
		events.on('error', (e) => errors.push(e));

		await expect(commit()).rejects.toThrow(/unshared chain depth/);

		expect(errors).toHaveLength(1);
		expect(errors[0].origin).toBe('commit');
		expect(takeDevWarns().map((w) => w.tag)).toContain('invariant:multi-scope-scope-depth');
	});
});
