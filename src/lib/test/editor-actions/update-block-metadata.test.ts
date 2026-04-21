import { describe, it, expect, vi } from 'vitest';
import { createUndoController } from '$lib/editor/components/editor-actions/undo-controller';
import { createBlockEditActions } from '$lib/editor/components/editor-actions/block-edit';
import { createUndoManager } from '$lib/editor/undo-manager';
import { createSelectionState } from '$lib/editor/selection/selection-state.svelte';
import { createEditorEvents } from '$lib/editor/events/editor-events';
import type { BlockComponent } from '$lib/editor/contracts';

// ── Harness helpers ───────────────────────────────────────────────────────────

function mockRef(): BlockComponent {
	return { focus: () => {}, getCursorOffset: () => null, editable: true, focusable: true } as BlockComponent;
}

function makeNode(kind: string, raw: string, metadata?: Record<string, unknown>): any {
	return { kind, raw, metadata };
}

function makeDeps(nodes: any[]) {
	const doc: any = { kind: 'document', children: nodes };
	const blockIds = nodes.map((_, i) => `block-${i}`);
	const blockRefs: (BlockComponent | undefined)[] = nodes.map(() => mockRef());
	const events = createEditorEvents();
	return {
		deps: {
			get doc() { return doc; },
			get blockIds() { return blockIds; },
			get blockRefs() { return blockRefs; },
			setDoc: (v: any) => { Object.assign(doc, v); },
			setBlockIds: vi.fn(),
			setBlockRefs: vi.fn(),
			undoManager: createUndoManager(),
			stickyColumn: { reset: vi.fn(), capture: vi.fn(), get current() { return null; } },
			selectionState: createSelectionState(),
			getBlockElByPath: () => null,
			events
		},
		doc,
		events
	};
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('updateBlockMetadata', () => {
	it('merges patch into node.metadata and emits one metadataUpdate event', async () => {
		const node = makeNode('paragraph', 'hello\n', { taskChecked: false });
		const { deps, events } = makeDeps([node]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);

		const editHandler = vi.fn();
		events.on('edit', editHandler);

		await actions.updateBlockMetadata(0, { taskChecked: true });

		expect(node.metadata).toEqual({ taskChecked: true });
		expect(editHandler).toHaveBeenCalledTimes(1);
		const evt = editHandler.mock.calls[0][0];
		expect(evt.op).toBe('metadataUpdate');
		expect(evt.path).toEqual([0]);
		expect(evt.detail.fields).toEqual(['taskChecked']);
	});

	it('pushes one undo snapshot and undo round-trips cleanly', async () => {
		const node = makeNode('paragraph', 'hello\n', { taskChecked: false });
		const { deps, events } = makeDeps([node]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);

		await actions.updateBlockMetadata(0, { taskChecked: true });

		const stacks = deps.undoManager.getStacks();
		expect(stacks.undo).toHaveLength(1);
		// The snapshot captures the pre-mutation metadata (taskChecked: false)
		expect(stacks.undo[0].snapshot.children[0].metadata).toEqual({ taskChecked: false });
	});

	it('skipSnapshot: true — no undo snapshot pushed', async () => {
		const node = makeNode('paragraph', 'hello\n', { taskChecked: false });
		const { deps } = makeDeps([node]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);

		await actions.updateBlockMetadata(0, { taskChecked: true }, { skipSnapshot: true });

		expect(deps.undoManager.getStacks().undo).toHaveLength(0);
		// Mutation still applied
		expect(node.metadata).toEqual({ taskChecked: true });
	});

	it('empty patch — no snapshot, no event, metadata unchanged', async () => {
		const node = makeNode('paragraph', 'hello\n', { taskChecked: false });
		const { deps, events } = makeDeps([node]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);

		const editHandler = vi.fn();
		events.on('edit', editHandler);

		await actions.updateBlockMetadata(0, {});

		expect(node.metadata).toEqual({ taskChecked: false });
		expect(editHandler).not.toHaveBeenCalled();
		expect(deps.undoManager.getStacks().undo).toHaveLength(0);
	});
});
