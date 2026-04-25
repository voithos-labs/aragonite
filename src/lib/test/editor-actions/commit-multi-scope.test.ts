import { describe, it, expect, vi } from 'vitest';
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

describe('commitMultiScope', () => {
	it('single-scope insert: updates children, ids, and fires one event', async () => {
		const containerNode = makeContainerNode(['- a\n', '- b\n']);
		const state = makeBlockListState(['id-a', 'id-b']);
		const { deps, events } = makeEditorActionsDeps([containerNode]);
		const controller = createUndoController(deps);

		const editHandler = vi.fn();
		events.on('edit', editHandler);

		await controller.commitMultiScope({
			scopes: [{ node: containerNode, state }],
			snapshot: { blockIndex: 0, offset: 0 },
			mutate: ([scope]) => {
				scope.children.push({ kind: 'listItem', leadingTrivia: '', raw: '- c\n' });
				return [{ op: 'insert', at: 2, count: 1 }];
			},
			op: { kind: 'appendBlock', eventPath: [0, 2] }
		});

		expect(containerNode.children).toHaveLength(3);
		expect(state.innerBlockIds).toHaveLength(3);
		expect(state.innerBlockIds[2]).toBeTruthy();
		expect(state.innerBlockIds[2]).not.toBe('id-a');
		expect(state.innerBlockIds[2]).not.toBe('id-b');
		expect(editHandler).toHaveBeenCalledTimes(1);
		expect(editHandler.mock.calls[0][0]).toMatchObject({ op: 'appendBlock', path: [0, 2] });
		expect(deps.undoManager.getStacks().undo).toHaveLength(1);
	});

	it('multi-scope: two scopes each get independent descriptors, still ONE snapshot + ONE event', async () => {
		const nodeA = makeContainerNode(['- a\n', '- b\n', '- c\n']);
		const nodeB = makeContainerNode(['- x\n', '- y\n']);
		const stateA = makeBlockListState(['a0', 'a1', 'a2']);
		const stateB = makeBlockListState(['b0', 'b1']);
		const { deps, events } = makeEditorActionsDeps([nodeA, nodeB]);
		const controller = createUndoController(deps);

		const editHandler = vi.fn();
		events.on('edit', editHandler);

		await controller.commitMultiScope({
			scopes: [
				{ node: nodeA, state: stateA },
				{ node: nodeB, state: stateB }
			],
			snapshot: { blockIndex: 0, offset: 0 },
			mutate: ([scopeA, scopeB]) => {
				scopeA.children.push({ kind: 'listItem', leadingTrivia: '', raw: '- d\n' });
				scopeB.children.splice(1, 1);
				return [
					{ op: 'insert', at: 3, count: 1 },
					{ op: 'delete', at: 1, count: 1 }
				];
			},
			op: { kind: 'split', eventPath: [0, 1] }
		});

		expect(nodeA.children).toHaveLength(4);
		expect(stateA.innerBlockIds).toHaveLength(4);
		expect(nodeB.children).toHaveLength(1);
		expect(stateB.innerBlockIds).toHaveLength(1);
		expect(stateB.innerBlockIds[0]).toBe('b0');
		expect(deps.undoManager.getStacks().undo).toHaveLength(1);
		expect(editHandler).toHaveBeenCalledTimes(1);
	});

	it('throws when mutate returns wrong number of changes', async () => {
		const nodeA = makeContainerNode(['- a\n']);
		const nodeB = makeContainerNode(['- b\n']);
		const stateA = makeBlockListState(['a0']);
		const stateB = makeBlockListState(['b0']);
		const { deps } = makeEditorActionsDeps([nodeA, nodeB]);
		const controller = createUndoController(deps);

		await expect(
			controller.commitMultiScope({
				scopes: [
					{ node: nodeA, state: stateA },
					{ node: nodeB, state: stateB }
				],
				snapshot: { blockIndex: 0, offset: 0 },
				mutate: () => [{ op: 'noop' }]
			})
		).rejects.toThrow('commitMultiScope: mutate returned 1 changes for 2 scopes');
	});

	it('noop descriptor leaves ids/refs unchanged but still fires event when op supplied', async () => {
		const containerNode = makeContainerNode(['- a\n']);
		const state = makeBlockListState(['id-a']);
		const { deps, events } = makeEditorActionsDeps([containerNode]);
		const controller = createUndoController(deps);

		const editHandler = vi.fn();
		events.on('edit', editHandler);

		await controller.commitMultiScope({
			scopes: [{ node: containerNode, state }],
			snapshot: { blockIndex: 0, offset: 0 },
			mutate: () => [{ op: 'noop' }],
			op: { kind: 'delete', eventPath: [0] }
		});

		expect(state.innerBlockIds).toEqual(['id-a']);
		expect(editHandler).toHaveBeenCalledTimes(1);
	});

	it('idMap preserved across scope: split-shape replace keeps old id at mapped position', async () => {
		const containerNode = makeContainerNode(['- a\n']);
		const originalId = 'original-id';
		const state = makeBlockListState([originalId]);
		const { deps } = makeEditorActionsDeps([containerNode]);
		const controller = createUndoController(deps);

		await controller.commitMultiScope({
			scopes: [{ node: containerNode, state }],
			snapshot: { blockIndex: 0, offset: 0 },
			mutate: ([scope]) => {
				const original = scope.children[0];
				scope.children.splice(0, 1, original, {
					kind: 'listItem',
					leadingTrivia: '',
					raw: '- a2\n'
				});
				return [{ op: 'replace', at: 0, count: 1, newCount: 2, idMap: { 0: 0 } }];
			}
		});

		expect(state.innerBlockIds).toHaveLength(2);
		expect(state.innerBlockIds[0]).toBe(originalId);
		expect(state.innerBlockIds[1]).not.toBe(originalId);
	});
});
