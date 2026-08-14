import { describe, it, expect, vi, afterEach } from 'vitest';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { asDocPath } from '$lib/selection/path-math';
import type { CommitMultiScopeArgs, MultiScopeTarget } from '$lib/editor-actions/deps';
import { makeBlockListState, makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { allowDevWarns } from '$lib/test/support/warn-gate';

// The scope fixtures are minimal hand-built containers, not parser output, so the container-raw
// oracle reads them as stale; the ids and refs under test do not care.
afterEach(() => allowDevWarns(['invariant:stale-raw']));

function makeContainerNode(childRaws: string[], leadingTrivia = ''): any {
	return {
		kind: 'list',
		leadingTrivia,
		raw: childRaws.join(''),
		children: childRaws.map((r) => ({ kind: 'listItem', leadingTrivia: '', raw: r }))
	};
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('commitMultiScope', () => {
	it('single-scope insert: updates children, ids, and fires one event', async () => {
		const { deps, events } = makeEditorActionsDeps([makeContainerNode(['- a\n', '- b\n'])]);
		const state = makeBlockListState(() => deps.doc.children[0], ['id-a', 'id-b']);
		const controller = createUndoController(deps);

		const editHandler = vi.fn();
		events.on('edit', editHandler);

		await controller.commitMultiScope({
			scopes: [{ node: deps.doc.children[0], state, path: [0] }],
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: ([scope]) => {
				scope.children.push({
					kind: 'listItem',
					leadingTrivia: '',
					raw: '- c\n',
					metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null }
				});
				return [{ op: 'insert', at: 2, count: 1 }];
			},
			op: { kind: 'appendBlock', eventPath: asDocPath([0, 2]) }
		});

		expect(deps.doc.children[0].children).toHaveLength(3);
		expect(state.innerBlockIds).toHaveLength(3);
		expect(state.innerBlockIds[2]).toBeTruthy();
		expect(state.innerBlockIds[2]).not.toBe('id-a');
		expect(state.innerBlockIds[2]).not.toBe('id-b');
		expect(editHandler).toHaveBeenCalledTimes(1);
		expect(editHandler.mock.calls[0][0]).toMatchObject({ op: 'appendBlock', path: [0, 2] });
		expect(deps.undoManager.getStacks().undo).toHaveLength(1);
	});

	it('multi-scope: two scopes each get independent descriptors, still ONE snapshot + ONE event', async () => {
		// A separator and a different bullet: two TIGHT `-` lists are one list on reload, which
		// the ancestry settle now folds them back into.
		const { deps, events } = makeEditorActionsDeps([
			makeContainerNode(['- a\n', '- b\n', '- c\n']),
			makeContainerNode(['* x\n', '* y\n'], '\n')
		]);
		const stateA = makeBlockListState(() => deps.doc.children[0], ['a0', 'a1', 'a2']);
		const stateB = makeBlockListState(() => deps.doc.children[1], ['b0', 'b1']);
		const controller = createUndoController(deps);

		const editHandler = vi.fn();
		events.on('edit', editHandler);

		await controller.commitMultiScope({
			scopes: [
				{ node: deps.doc.children[0], state: stateA, path: [0] },
				{ node: deps.doc.children[1], state: stateB, path: [1] }
			],
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: ([scopeA, scopeB]) => {
				scopeA.children.push({
					kind: 'listItem',
					leadingTrivia: '',
					raw: '- d\n',
					metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null }
				});
				scopeB.children.splice(1, 1);
				return [
					{ op: 'insert', at: 3, count: 1 },
					{ op: 'delete', at: 1, count: 1 }
				];
			},
			op: { kind: 'split', detail: { at: 0 }, eventPath: asDocPath([0, 1]) }
		});

		expect(deps.doc.children[0].children).toHaveLength(4);
		expect(stateA.innerBlockIds).toHaveLength(4);
		expect(deps.doc.children[1].children).toHaveLength(1);
		expect(stateB.innerBlockIds).toHaveLength(1);
		expect(stateB.innerBlockIds[0]).toBe('b0');
		expect(deps.undoManager.getStacks().undo).toHaveLength(1);
		expect(editHandler).toHaveBeenCalledTimes(1);
	});

	// A container that never mounted has no `childIds` at all, which is not the same fact as an
	// EMPTY one — and the paste ceremony reaches exactly that scope through its unmounted stand-in
	// (`tree-operations/paste/parent-scope.ts`). Miss-analysis: every fixture in this file mints
	// ids first, so the ceremony was only ever asked to grow an array that already fit.
	it('a scope that never mounted publishes one id per child, not one per insert', async () => {
		const { deps } = makeEditorActionsDeps([makeContainerNode(['- a\n', '- b\n', '- c\n'])]);
		const owned = deps.doc.children[0];
		expect(owned.childIds).toBeUndefined();
		const state = { innerBlockIds: [...(owned.childIds ?? [])], innerBlockRefs: [] };
		const controller = createUndoController(deps);

		await controller.commitMultiScope({
			scopes: [{ node: owned, state, path: [0] }],
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: ([scope]) => {
				scope.children.push({
					kind: 'listItem',
					leadingTrivia: '',
					raw: '- d\n',
					metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null }
				});
				return [{ op: 'insert', at: 3, count: 1 }];
			},
			op: { kind: 'appendBlock', eventPath: asDocPath([0, 3]) }
		});

		const published = deps.doc.children[0];
		expect(published.children).toHaveLength(4);
		expect(published.childIds).toHaveLength(4);
		expect(new Set(published.childIds).size).toBe(4);
	});

	it('unshares each scope before mutate: the snapshot keeps the pre-commit nodes intact', async () => {
		const { deps } = makeEditorActionsDeps([makeContainerNode(['- a\n', '- b\n'])]);
		const state = makeBlockListState(() => deps.doc.children[0], ['id-a', 'id-b']);
		const controller = createUndoController(deps);
		const before = deps.doc.children[0];
		const beforeChildIds = before.childIds;

		await controller.commitMultiScope({
			scopes: [{ node: before, state, path: [0] }],
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: ([scope]) => {
				scope.children.splice(0, 1);
				return [{ op: 'delete', at: 0, count: 1 }];
			}
		});

		const entry = deps.undoManager.getStacks().undo[0];
		expect(entry.snapshot.children[0]).toBe(before);
		expect(before.children).toHaveLength(2);
		expect(before.childIds).toBe(beforeChildIds);
		expect(deps.doc.children[0]).not.toBe(before);
		expect(deps.doc.children[0].children).toHaveLength(1);
		expect(state.innerBlockIds).toEqual(['id-b']);
	});

	it('throws when mutate returns wrong number of changes', async () => {
		const { deps } = makeEditorActionsDeps([
			makeContainerNode(['- a\n']),
			makeContainerNode(['- b\n'])
		]);
		const stateA = makeBlockListState(() => deps.doc.children[0], ['a0']);
		const stateB = makeBlockListState(() => deps.doc.children[1], ['b0']);
		const controller = createUndoController(deps);

		// Array (not tuple) typing lets the wrong arity compile, reaching the runtime backstop.
		const scopes: MultiScopeTarget[] = [
			{ node: deps.doc.children[0], state: stateA, path: [0] },
			{ node: deps.doc.children[1], state: stateB, path: [1] }
		];
		await expect(
			controller.commitMultiScope({
				scopes,
				snapshot: { path: asDocPath([0]), offset: 0 },
				mutate: () => [{ op: 'noop' }]
			})
		).rejects.toThrow('commitMultiScope: mutate returned 1 changes for 2 scopes');
	});

	it('noop descriptor leaves ids/refs unchanged but still fires event when op supplied', async () => {
		const { deps, events } = makeEditorActionsDeps([makeContainerNode(['- a\n'])]);
		const state = makeBlockListState(() => deps.doc.children[0], ['id-a']);
		const controller = createUndoController(deps);

		const editHandler = vi.fn();
		events.on('edit', editHandler);

		await controller.commitMultiScope({
			scopes: [{ node: deps.doc.children[0], state, path: [0] }],
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: () => [{ op: 'noop' }],
			op: { kind: 'delete', eventPath: asDocPath([0]) }
		});

		expect(state.innerBlockIds).toEqual(['id-a']);
		expect(editHandler).toHaveBeenCalledTimes(1);
	});

	it('idMap preserved across scope: split-shape replace keeps old id at mapped position', async () => {
		const originalId = 'original-id';
		const { deps } = makeEditorActionsDeps([makeContainerNode(['- a\n'])]);
		const state = makeBlockListState(() => deps.doc.children[0], [originalId]);
		const controller = createUndoController(deps);

		await controller.commitMultiScope({
			scopes: [{ node: deps.doc.children[0], state, path: [0] }],
			snapshot: { path: asDocPath([0]), offset: 0 },
			mutate: ([scope]) => {
				const original = scope.children[0];
				scope.children.splice(0, 1, original, {
					kind: 'listItem',
					leadingTrivia: '',
					raw: '- a2\n',
					metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null }
				});
				return [{ op: 'replace', at: 0, count: 1, newCount: 2, idMap: { 0: 0 } }];
			}
		});

		expect(state.innerBlockIds).toHaveLength(2);
		expect(state.innerBlockIds[0]).toBe(originalId);
		expect(state.innerBlockIds[1]).not.toBe(originalId);
	});

	// Compile-pin, enforced by `npm run check` (vitest does not typecheck): if
	// the tuple-typed mutate contract loosens, the directive turns unused and
	// check fails.
	it('tuple contract: literal two-scope commit with one returned change is a type error', () => {
		const nodeA = makeContainerNode(['- a\n']);
		const nodeB = makeContainerNode(['- b\n']);
		const scopeA: MultiScopeTarget = {
			node: nodeA,
			state: makeBlockListState(() => nodeA),
			path: [0]
		};
		const scopeB: MultiScopeTarget = {
			node: nodeB,
			state: makeBlockListState(() => nodeB),
			path: [1]
		};
		const bad: CommitMultiScopeArgs<[MultiScopeTarget, MultiScopeTarget]> = {
			scopes: [scopeA, scopeB],
			snapshot: 'skip',
			// @ts-expect-error — mutate must return exactly one StructuralChange per scope
			mutate: () => [{ op: 'noop' }]
		};
		void bad;
	});
});
