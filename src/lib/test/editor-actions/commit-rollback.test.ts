import { describe, it, expect } from 'vitest';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import type { MultiScopeTarget } from '$lib/editor-actions/deps';
import { concatChildren, serialize } from '$lib/core/serializer';
import { makeBlockListState, makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import type { UndoEntry } from '$lib/undo/types';

function makeContainerNode(childRaws: string[]): any {
	return {
		kind: 'list',
		leadingTrivia: '',
		raw: childRaws.join(''),
		children: childRaws.map((r) => ({ kind: 'listItem', leadingTrivia: '', raw: r }))
	};
}

/** Serialized snapshot bytes per stack entry — byte-identity across a throw. */
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
				snapshot: { path: [0], offset: 0 },
				mutate: () => {
					throw new Error('boom');
				}
			})
		).rejects.toThrow('boom'); // DEV re-throw preserved

		expect(deps.undoManager.getStacks().undo.length).toBe(before); // rolled back (was before+1 before the fix)
		expect(errors).toHaveLength(1);
		expect(errors[0].origin).toBe('commit');
	});

	it('restores the redo stack, not just undo, after a throwing commit', async () => {
		const { deps } = makeEditorActionsDeps([makeContainerNode(['- a\n', '- b\n'])]);
		const state = makeBlockListState(() => deps.doc.children[0], ['id-a', 'id-b']);
		const controller = createUndoController(deps);

		// A successful commit then an undo populates the redo stack, so the catch
		// has both stacks to restore — a regression restoring only undo would drift
		// redo and stay invisible to an undo-length-only assertion.
		await controller.commitMultiScope({
			scopes: [{ node: deps.doc.children[0], state, path: [0] }],
			snapshot: { path: [0], offset: 0 },
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
				snapshot: { path: [0], offset: 0 },
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

		// Splice the live scope view, then trip the production arity check — the
		// real "throws AFTER all splices completed" path. Without the rollback the
		// spliced copy stays in deps.doc with stale ancestor raw.
		// Array (not tuple) typing degrades the return so the wrong arity compiles.
		const scopes: MultiScopeTarget[] = [{ node: originalContainer, state, path: [0] }];
		await expect(
			controller.commitMultiScope({
				scopes,
				snapshot: { path: [0], offset: 0 },
				mutate: ([scope]) => {
					scope.children.splice(0, 1);
					return []; // wrong arity → production throw after the splice
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

		// First commit pushes a real snapshot — bumping the epoch and unsharing
		// children[0], which is now owned at the current epoch.
		await controller.commitMultiScope({
			scopes: [{ node: deps.doc.children[0], state, path: [0] }],
			snapshot: { path: [0], offset: 0 },
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

		// Second commit is `snapshot:'skip'` (a same-unit join). The scope node is
		// already owned at this epoch, so copy-path-on-write is a no-op: the splice
		// lands in place. A top-level array swap can't reach the in-place mutation —
		// the in-scope arrays must be captured and restored too.
		const scopes: MultiScopeTarget[] = [{ node: ownedContainer, state, path: [0] }];
		await expect(
			controller.commitMultiScope({
				scopes,
				snapshot: 'skip',
				mutate: ([scope]) => {
					scope.children.splice(0, 1);
					return []; // wrong arity → production throw after the splice
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
				snapshot: { path: [0], offset: 0 },
				mutate: ([scope]) => {
					scope.children.splice(0, 1); // drop a top-level block
					return []; // wrong arity → production throw after the splice
				}
			})
		).rejects.toThrow('commitMultiScope: mutate returned 0 changes for 1 scopes');

		expect(serialize(deps.doc)).toBe(serializedBefore);
	});

	// Integrated frame guard: one throw must recover the document AND both stacks
	// at once. The other tests split the concern — test 2 pins the stacks with no
	// tree change; the splice tests pin the tree but start with empty stacks and
	// never assert them. Here a snapshot is pushed (clearing redo) and the live
	// tree is spliced before the throw, so dropping either register from the
	// consolidated rollback surfaces here.
	it('a splice-then-throw restores the document AND both stacks together', async () => {
		const { deps } = makeEditorActionsDeps([makeContainerNode(['- a\n', '- b\n'])]);
		const state = makeBlockListState(() => deps.doc.children[0], ['id-a', 'id-b']);
		const controller = createUndoController(deps);

		// Two real commits then one undo leaves undo AND redo non-empty.
		const appendItem = (raw: string, at: number): Promise<void> =>
			controller.commitMultiScope({
				scopes: [{ node: deps.doc.children[0], state, path: [0] }],
				snapshot: { path: [0], offset: 0 },
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
				snapshot: { path: [0], offset: 0 },
				mutate: (([scope]: readonly [{ children: unknown[] }]) => {
					scope.children.splice(0, 1); // real live-tree mutation
					return []; // wrong arity → production throw after the splice
				}) as never
			})
		).rejects.toThrow('commitMultiScope: mutate returned 0 changes for 1 scopes');

		const after = deps.undoManager.getStacks();
		expect(serialize(deps.doc)).toBe(serializedBefore);
		expect(stackBytes(after.undo)).toEqual(stackBytes(before.undo));
		expect(stackBytes(after.redo)).toEqual(stackBytes(before.redo));
	});
});
