// A multi-scope target whose `path` does not address its `node` used to fall back
// to the caller's node — never unshared — so the mutation spliced the live,
// snapshot-shared node and the freshest undo entry observed the splice. Nothing
// threw: G1.19 and G1.22 are dev-only warnings. The sibling seam
// (`withUnsharedSpine`, G1.20) bails on the same input; so does this one now.
import { describe, it, expect } from 'vitest';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { parse } from '$lib/core/parser';
import { concatChildren, serialize } from '$lib/core/serializer';
import type { CstNode } from '$lib/core/nodes';
import type { EditorError } from '$lib/editor-events';
import type { MultiScopeTarget } from '$lib/editor-actions/deps';
import { makeBlockListState, makeEditorActionsDeps } from '$lib/test/harness/editor-actions';

function listItemNode(raw: string): CstNode {
	return {
		kind: 'listItem',
		leadingTrivia: '',
		raw,
		metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null }
	} as CstNode;
}

function harness(scopePath: number[]) {
	const { deps, events } = makeEditorActionsDeps(parse('- a\n- b\n').children);
	const controller = createUndoController(deps);
	const state = makeBlockListState(() => deps.doc.children[0]);
	// A pushed snapshot is what makes the live node shared — the state in which a
	// write through it corrupts history.
	controller.pushUndoSnapshot(0, 0);
	const scopes: MultiScopeTarget[] = [{ node: deps.doc.children[0], state, path: scopePath }];
	const commit = (): Promise<void> =>
		controller.commitMultiScope({
			scopes,
			snapshot: 'skip',
			mutate: ([scope]) => {
				scope.children.push(listItemNode('- c\n'));
				return [{ op: 'insert', at: scope.children.length - 1, count: 1 }];
			}
		});
	return { deps, events, commit };
}

describe('commitMultiScope bails on a scope path that ran off the tree', () => {
	// [99]: the whole walk misses. [0, 99]: the walk truncates mid-spine, so the
	// fallback handed over the ANCESTOR — the same class one rung less obvious.
	for (const scopePath of [[99], [0, 99]]) {
		it(`writes nothing through the shared tree for path [${scopePath.join(',')}]`, async () => {
			const { deps, commit } = harness(scopePath);
			// The children array is the oracle, not `serialize`: a [99] walk rebuilds
			// no raw at all, so the corrupted entry is invisible to a byte compare.
			const sharedList = deps.undoManager.peekUndo()!.snapshot.children[0];
			const sharedBefore = concatChildren(sharedList.children ?? []);
			const treeBefore = serialize(deps.doc);

			await commit().catch(() => {});

			expect(concatChildren(sharedList.children ?? [])).toBe(sharedBefore);
			expect(concatChildren(deps.doc.children[0].children ?? [])).toBe(sharedBefore);
			expect(serialize(deps.doc)).toBe(treeBefore);
		});
	}

	it('reports the bail on the error seam instead of failing silently', async () => {
		const { events, commit } = harness([99]);
		const errors: EditorError[] = [];
		events.on('error', (e) => errors.push(e));

		await expect(commit()).rejects.toThrow(/unshared chain depth/);

		expect(errors).toHaveLength(1);
		expect(errors[0].origin).toBe('commit');
	});
});
