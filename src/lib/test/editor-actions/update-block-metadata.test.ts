import { describe, it, expect, vi } from 'vitest';
import { createUndoController } from '$lib/editor/components/editor-actions/undo-controller';
import { createBlockEditActions } from '$lib/editor/components/editor-actions/block-edit';
import { createContainerEditActions } from '$lib/editor/components/editor-actions/container-edit';
import { createHistoryActions } from '$lib/editor/components/editor-actions/history';
import { createStandardNestedActions } from '$lib/editor/components/blocks/container-state/nested-actions';
import { createBlockListState } from '$lib/editor/components/blocks/container-state/block-list-state.svelte';
import { createUndoManager } from '$lib/editor/undo-manager';
import { createSelectionState } from '$lib/editor/selection/selection-state.svelte';
import { createEditorEvents } from '$lib/editor/events/editor-events';
import type { BlockComponent, BlockEditActions, FocusActions } from '$lib/editor/contracts';
import type { StickyColumnState } from '$lib/editor/contenteditable/sticky-column';

// ── Harness helpers ───────────────────────────────────────────────────────────

function mockRef(): BlockComponent {
	return { focus: () => {}, getCursorOffset: () => null, editable: true, focusable: true } as BlockComponent;
}

function makeNode(kind: string, raw: string, metadata?: Record<string, unknown>): any {
	return { kind, leadingTrivia: '', raw, metadata };
}

function makeStickyColumn(): StickyColumnState {
	return { get: () => null, reset: vi.fn(), capture: vi.fn() };
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
			stickyColumn: makeStickyColumn(),
			selectionState: createSelectionState(),
			getBlockElByPath: () => null,
			events
		},
		doc,
		events
	};
}

// ── Top-level scope ───────────────────────────────────────────────────────────

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

	it('pushes exactly one undo snapshot, and undo/redo flip metadata back and forth', async () => {
		const node = makeNode('paragraph', 'hello\n', { taskChecked: false });
		const { deps, events } = makeDeps([node]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);
		const history = createHistoryActions(deps, controller);

		await actions.updateBlockMetadata(0, { taskChecked: true });

		// One snapshot in undo stack capturing pre-mutation state
		const stacks = deps.undoManager.getStacks();
		expect(stacks.undo).toHaveLength(1);
		expect(stacks.undo[0].snapshot.children[0].metadata).toEqual({ taskChecked: false });

		// Undo restores taskChecked: false
		await history.requestUndo();
		expect(deps.doc.children[0].metadata).toEqual({ taskChecked: false });

		// Redo re-applies taskChecked: true
		await history.requestRedo();
		expect(deps.doc.children[0].metadata).toEqual({ taskChecked: true });
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

	it('shallow-merge preserves untouched fields', async () => {
		// Multi-field starting metadata: patching one key must not clobber others.
		// A regression to `node.metadata = metadata` (no spread) would fail this.
		const node = makeNode('list-item', '- [ ] task\n', {
			marker: '- ',
			taskItem: true,
			taskChecked: false
		});
		const { deps } = makeDeps([node]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);

		await actions.updateBlockMetadata(0, { taskChecked: true });

		expect(node.metadata).toEqual({ marker: '- ', taskItem: true, taskChecked: true });
	});
});

// ── Container scope ───────────────────────────────────────────────────────────

function makeContainerSetup(containerIndex: number) {
	const innerNode = makeNode('paragraph', 'hello\n', { marker: '- ', taskItem: true, taskChecked: false });
	const containerNode: any = {
		kind: 'blockquote',
		leadingTrivia: '',
		raw: '> hello\n',
		children: [innerNode],
		innerPrefix: '> ',
		innerSuffix: ''
	};

	// Pad doc children so containerIndex is meaningful
	const padNode = makeNode('paragraph', 'pad\n', {});
	const docNodes = Array.from({ length: containerIndex }, () => padNode).concat([containerNode]);

	const doc: any = { kind: 'document', children: docNodes };
	const blockIds = docNodes.map((_, i) => `block-${i}`);
	const blockRefs: (BlockComponent | undefined)[] = docNodes.map(() => mockRef());
	const events = createEditorEvents();
	const deps = {
		get doc() { return doc; },
		get blockIds() { return blockIds; },
		get blockRefs() { return blockRefs; },
		setDoc: (v: any) => { Object.assign(doc, v); },
		setBlockIds: vi.fn(),
		setBlockRefs: vi.fn(),
		undoManager: createUndoManager(),
		stickyColumn: makeStickyColumn(),
		selectionState: createSelectionState(),
		getBlockElByPath: () => null,
		events
	};

	const controller = createUndoController(deps);
	const containerEditActions = createContainerEditActions(deps, controller);

	// Minimal parent bundle wired to real container-edit actions so
	// commitContainer actually executes the mutation callback.
	const parentBlockEdit: BlockEditActions = {
		splitBlock: vi.fn(),
		mergeWithPrevious: vi.fn(),
		mergeWithNext: vi.fn(),
		deleteBlock: vi.fn(),
		updateBlockContent: vi.fn(),
		updateBlockMetadata: vi.fn(),
		insertParsedBlocks: vi.fn(),
		replaceBlock: vi.fn()
	};
	const parentFocus: FocusActions = { moveFocus: vi.fn() };

	const containerState = createBlockListState(() => containerNode);
	const bundle = createStandardNestedActions(containerState, {
		index: containerIndex,
		get node() { return containerNode; },
		rebuildRaw: vi.fn(),
		stickyColumn: makeStickyColumn(),
		parent: {
			blockEdit: parentBlockEdit,
			focus: parentFocus,
			containerEdit: containerEditActions
		}
	});

	return { bundle, innerNode, containerNode, deps, events, controller };
}

describe('updateBlockMetadata — container scope', () => {
	it('mutates inner node metadata and emits metadataUpdate with correct eventPath and fields', async () => {
		const containerIndex = 2;
		const { bundle, innerNode, events } = makeContainerSetup(containerIndex);

		const editHandler = vi.fn();
		events.on('edit', editHandler);

		await bundle.blockEdit.updateBlockMetadata(0, { taskChecked: true });

		// Mutation applied in place
		expect(innerNode.metadata).toMatchObject({ taskChecked: true });

		// One edit event with the correct path [containerIndex, innerIndex]
		expect(editHandler).toHaveBeenCalledTimes(1);
		const evt = editHandler.mock.calls[0][0];
		expect(evt.op).toBe('metadataUpdate');
		expect(evt.path).toEqual([containerIndex, 0]);
		expect(evt.detail.fields).toEqual(['taskChecked']);
	});

	it('skipSnapshot: true — commitContainer called with "skip" sentinel (no snapshot pushed)', async () => {
		const { bundle, deps } = makeContainerSetup(1);

		await bundle.blockEdit.updateBlockMetadata(0, { taskChecked: true }, { skipSnapshot: true });

		expect(deps.undoManager.getStacks().undo).toHaveLength(0);
	});

	it('empty patch — early-returns with no commitContainer call and no snapshot', async () => {
		const containerIndex = 1;
		const { bundle, deps, events } = makeContainerSetup(containerIndex);

		// Spy on containerEditActions.commitContainer via the edit event — no
		// event should fire for an empty patch.
		const editHandler = vi.fn();
		events.on('edit', editHandler);

		await bundle.blockEdit.updateBlockMetadata(0, {});

		expect(editHandler).not.toHaveBeenCalled();
		expect(deps.undoManager.getStacks().undo).toHaveLength(0);
	});
});
