import { describe, it, expect, afterEach } from 'vitest';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { asDocPath } from '$lib/selection/path-math';
import type { MultiScopeTarget } from '$lib/action-contracts';
import { concatChildren, serialize } from '$lib/core/serializer';
import { makeBlockListState, makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import type { UndoEntry } from '$lib/undo/types';
import { allowDevWarns } from '$lib/test/support/warn-gate';

// The scope fixtures are minimal hand-built containers, not parser output, so the container-raw
// oracle reads them as stale.
afterEach(() => allowDevWarns(['invariant:stale-raw']));

function makeContainerNode(childRaws: string[]): any {
	return {
		kind: 'list',
		leadingTrivia: '',
		raw: childRaws.join(''),
		children: childRaws.map((r) => ({ kind: 'listItem', leadingTrivia: '', raw: r }))
	};
}

function stackBytes(entries: UndoEntry[]): string[] {
	return entries.map((e) => serialize(e.snapshot));
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
				snapshot: { path: asDocPath([0]), offset: 0 },
				mutate: () => {
					throw new Error('boom');
				}
			})
		).rejects.toThrow('boom');

		expect(deps.undoManager.getStacks().undo.length).toBe(before);
		expect(errors).toHaveLength(1);
		expect(errors[0].origin).toBe('commit');
	});

	it('restores the redo stack, not just undo, after a throwing commit', async () => {
		const { deps } = makeEditorActionsDeps([makeContainerNode(['- a\n', '- b\n'])]);
		const state = makeBlockListState(() => deps.doc.children[0], ['id-a', 'id-b']);
		const controller = createUndoController(deps);

		// Populates redo so both stacks have something to restore — a regression
		// restoring only undo stays invisible to an undo-length-only assertion.
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
			}
		});
		deps.undoManager.undo(controller.captureCurrentState());

		const before = deps.undoManager.getStacks();
		expect(before.redo).toHaveLength(1);

		await expect(
			controller.commitMultiScope({
				scopes: [{ node: deps.doc.children[0], state, path: [0] }],
				snapshot: { path: asDocPath([0]), offset: 0 },
				mutate: () => {
					throw new Error('boom');
				}
			})
		).rejects.toThrow('boom');

		const after = deps.undoManager.getStacks();
		expect(stackBytes(after.redo)).toEqual(stackBytes(before.redo));
		expect(stackBytes(after.undo)).toEqual(stackBytes(before.undo));
	});

	it('leaves the live tree byte-identical when a container mutation splices then throws', async () => {
		const { deps } = makeEditorActionsDeps([makeContainerNode(['- a\n', '- b\n'])]);
		const state = makeBlockListState(() => deps.doc.children[0], ['id-a', 'id-b']);
		const controller = createUndoController(deps);

		const originalContainer = deps.doc.children[0];
		const childrenBefore = concatChildren(originalContainer.children ?? []);

		// Splices the live scope view, then trips the arity check: the real "throws AFTER
		// all splices completed" path. Array (not tuple) typing lets the wrong arity compile.
		const scopes: MultiScopeTarget[] = [{ node: originalContainer, state, path: [0] }];
		await expect(
			controller.commitMultiScope({
				scopes,
				snapshot: { path: asDocPath([0]), offset: 0 },
				mutate: ([scope]) => {
					scope.children.splice(0, 1);
					return [];
				}
			})
		).rejects.toThrow('commitMultiScope: mutate returned 0 changes for 1 scopes');

		expect(deps.doc.children[0]).toBe(originalContainer);
		expect(concatChildren(deps.doc.children[0].children ?? [])).toBe(childrenBefore);
	});

	it('rolls back an in-place splice on a node already unshared earlier in the same undo unit', async () => {
		const { deps } = makeEditorActionsDeps([makeContainerNode(['- a\n', '- b\n'])]);
		const state = makeBlockListState(() => deps.doc.children[0], ['id-a', 'id-b']);
		const controller = createUndoController(deps);

		// Pushes a real snapshot, bumping the epoch so children[0] ends up owned.
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
			}
		});

		const ownedContainer = deps.doc.children[0];
		const childrenBefore = concatChildren(ownedContainer.children ?? []);

		// A same-unit join against an already-owned node: copy-path-on-write no-ops and the
		// splice lands in place, where a top-level array swap cannot reach it.
		const scopes: MultiScopeTarget[] = [{ node: ownedContainer, state, path: [0] }];
		await expect(
			controller.commitMultiScope({
				scopes,
				snapshot: 'skip',
				mutate: ([scope]) => {
					scope.children.splice(0, 1);
					return [];
				}
			})
		).rejects.toThrow('commitMultiScope: mutate returned 0 changes for 1 scopes');

		expect(deps.doc.children[0]).toBe(ownedContainer);
		expect(concatChildren(deps.doc.children[0].children ?? [])).toBe(childrenBefore);
	});

	it('leaves the document scope byte-identical when a top-level mutation splices then throws', async () => {
		const { deps } = makeEditorActionsDeps([
			makeContainerNode(['- a\n']),
			makeContainerNode(['- b\n'])
		]);
		const controller = createUndoController(deps);

		const serializedBefore = serialize(deps.doc);

		const scopes: MultiScopeTarget[] = [controller.getDocScope()];
		await expect(
			controller.commitMultiScope({
				scopes,
				snapshot: { path: asDocPath([0]), offset: 0 },
				mutate: ([scope]) => {
					scope.children.splice(0, 1);
					return [];
				}
			})
		).rejects.toThrow('commitMultiScope: mutate returned 0 changes for 1 scopes');

		expect(serialize(deps.doc)).toBe(serializedBefore);
	});

	// The integrated frame guard: every other case pins the stacks or the tree, never
	// both, so dropping either register from the consolidated rollback surfaces only here.
	it('a splice-then-throw restores the document AND both stacks together', async () => {
		const { deps } = makeEditorActionsDeps([makeContainerNode(['- a\n', '- b\n'])]);
		const state = makeBlockListState(() => deps.doc.children[0], ['id-a', 'id-b']);
		const controller = createUndoController(deps);

		// Two real commits then one undo leaves undo AND redo non-empty.
		const appendItem = (raw: string, at: number): Promise<void> =>
			controller.commitMultiScope({
				scopes: [{ node: deps.doc.children[0], state, path: [0] }],
				snapshot: { path: asDocPath([0]), offset: 0 },
				mutate: ([scope]) => {
					scope.children.push({
						kind: 'listItem',
						leadingTrivia: '',
						raw,
						metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null }
					});
					return [{ op: 'insert', at, count: 1 }];
				}
			});
		await appendItem('- c\n', 2);
		await appendItem('- d\n', 3);
		deps.undoManager.undo(controller.captureCurrentState());

		const before = deps.undoManager.getStacks();
		expect(before.undo).toHaveLength(1);
		expect(before.redo).toHaveLength(1);
		const serializedBefore = serialize(deps.doc);

		await expect(
			controller.commitMultiScope({
				scopes: [{ node: deps.doc.children[0], state, path: [0] }],
				snapshot: { path: asDocPath([0]), offset: 0 },
				mutate: (([scope]: readonly [{ children: unknown[] }]) => {
					scope.children.splice(0, 1);
					return [];
				}) as never
			})
		).rejects.toThrow('commitMultiScope: mutate returned 0 changes for 1 scopes');

		const after = deps.undoManager.getStacks();
		expect(serialize(deps.doc)).toBe(serializedBefore);
		expect(stackBytes(after.undo)).toEqual(stackBytes(before.undo));
		expect(stackBytes(after.redo)).toEqual(stackBytes(before.redo));
	});
});
