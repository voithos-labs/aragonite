import { describe, it, expect, vi } from 'vitest';
import { createUndoController } from '$lib/editor/components/editor-actions/undo-controller';
import { createUndoManager } from '$lib/editor/undo-manager';
import { createSelectionState } from '$lib/editor/selection/selection-state.svelte';
import { createEditorEvents } from '$lib/editor/events/editor-events';
import type { BlockComponent } from '$lib/editor/contracts';

// ── Harness helpers ───────────────────────────────────────────────────────────

function mockRef(): BlockComponent {
	return {
		focus: () => {},
		getCursorOffset: () => null,
		editable: true,
		focusable: true
	} as BlockComponent;
}

function makeContainerNode(childRaws: string[]): any {
	return {
		kind: 'list',
		raw: childRaws.join(''),
		children: childRaws.map((r) => ({ kind: 'listItem', raw: r }))
	};
}

function makeBlockListState(node: any, ids: string[]): any {
	let innerBlockIds = [...ids];
	let innerBlockRefs: (BlockComponent | undefined)[] = ids.map(() => undefined);
	return {
		get innerBlockIds() {
			return innerBlockIds;
		},
		set innerBlockIds(v: string[]) {
			innerBlockIds = v;
		},
		get innerBlockRefs() {
			return innerBlockRefs;
		},
		set innerBlockRefs(v: (BlockComponent | undefined)[]) {
			innerBlockRefs = v;
		}
	};
}

function makeDeps(containerNodes: any[]) {
	const doc: any = { kind: 'document', children: containerNodes };
	const blockIds = containerNodes.map((_, i) => `block-${i}`);
	const blockRefs: (BlockComponent | undefined)[] = blockIds.map(() => undefined);
	const events = createEditorEvents();
	return {
		deps: {
			get doc() {
				return doc;
			},
			get blockIds() {
				return blockIds;
			},
			get blockRefs() {
				return blockRefs;
			},
			setDoc: (v: any) => {
				Object.assign(doc, v);
			},
			setBlockIds: vi.fn(),
			setBlockRefs: vi.fn(),
			undoManager: createUndoManager(),
			stickyColumn: {
				reset: vi.fn(),
				capture: vi.fn(),
				get current() {
					return null;
				}
			},
			selectionState: createSelectionState(),
			getBlockElByPath: () => null,
			events
		},
		doc,
		events
	};
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('commitMultiScope', () => {
	it('single-scope insert: updates children, ids, and fires one event', async () => {
		const containerNode = makeContainerNode(['- a\n', '- b\n']);
		const state = makeBlockListState(containerNode, ['id-a', 'id-b']);
		const { deps, events } = makeDeps([containerNode]);
		const controller = createUndoController(deps);

		const editHandler = vi.fn();
		events.on('edit', editHandler);

		await controller.commitMultiScope(
			[{ node: containerNode, state }],
			{ blockIndex: 0, offset: 0 },
			([scope]) => {
				scope.children.push({ kind: 'listItem', raw: '- c\n' });
				return [{ op: 'insert', at: 2, count: 1 }];
			},
			{ kind: 'appendBlock', eventPath: [0, 2] }
		);

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
		const stateA = makeBlockListState(nodeA, ['a0', 'a1', 'a2']);
		const stateB = makeBlockListState(nodeB, ['b0', 'b1']);
		const { deps, events } = makeDeps([nodeA, nodeB]);
		const controller = createUndoController(deps);

		const editHandler = vi.fn();
		events.on('edit', editHandler);

		await controller.commitMultiScope(
			[
				{ node: nodeA, state: stateA },
				{ node: nodeB, state: stateB }
			],
			{ blockIndex: 0, offset: 0 },
			([scopeA, scopeB]) => {
				scopeA.children.push({ kind: 'listItem', raw: '- d\n' });
				scopeB.children.splice(1, 1);
				return [
					{ op: 'insert', at: 3, count: 1 },
					{ op: 'delete', at: 1, count: 1 }
				];
			},
			{ kind: 'split', eventPath: [0, 1] }
		);

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
		const stateA = makeBlockListState(nodeA, ['a0']);
		const stateB = makeBlockListState(nodeB, ['b0']);
		const { deps } = makeDeps([nodeA, nodeB]);
		const controller = createUndoController(deps);

		await expect(
			controller.commitMultiScope(
				[
					{ node: nodeA, state: stateA },
					{ node: nodeB, state: stateB }
				],
				{ blockIndex: 0, offset: 0 },
				() => [{ op: 'noop' }]
			)
		).rejects.toThrow('commitMultiScope: mutate returned 1 changes for 2 scopes');
	});

	it('noop descriptor leaves ids/refs unchanged but still fires event when op supplied', async () => {
		const containerNode = makeContainerNode(['- a\n']);
		const state = makeBlockListState(containerNode, ['id-a']);
		const { deps, events } = makeDeps([containerNode]);
		const controller = createUndoController(deps);

		const editHandler = vi.fn();
		events.on('edit', editHandler);

		await controller.commitMultiScope(
			[{ node: containerNode, state }],
			{ blockIndex: 0, offset: 0 },
			() => [{ op: 'noop' }],
			{ kind: 'delete', eventPath: [0] }
		);

		expect(state.innerBlockIds).toEqual(['id-a']);
		expect(editHandler).toHaveBeenCalledTimes(1);
	});

	it('idMap preserved across scope: split-shape replace keeps old id at mapped position', async () => {
		const containerNode = makeContainerNode(['- a\n']);
		const originalId = 'original-id';
		const state = makeBlockListState(containerNode, [originalId]);
		const { deps } = makeDeps([containerNode]);
		const controller = createUndoController(deps);

		await controller.commitMultiScope(
			[{ node: containerNode, state }],
			{ blockIndex: 0, offset: 0 },
			([scope]) => {
				const original = scope.children[0];
				scope.children.splice(0, 1, original, { kind: 'listItem', raw: '- a2\n' });
				return [{ op: 'replace', at: 0, count: 1, newCount: 2, idMap: { 0: 0 } }];
			}
		);

		expect(state.innerBlockIds).toHaveLength(2);
		expect(state.innerBlockIds[0]).toBe(originalId);
		expect(state.innerBlockIds[1]).not.toBe(originalId);
	});
});
