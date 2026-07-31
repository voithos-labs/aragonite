import { describe, it, expect, vi } from 'vitest';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { createHistoryActions } from '$lib/editor-actions/commit/history';
import { makeEditorActionsDeps, makeNestedHarness } from '$lib/test/harness/editor-actions';

function makeNode(kind: string, raw: string, metadata?: Record<string, unknown>): any {
	return { kind, leadingTrivia: '', raw, metadata };
}

// rebuildListItemRaw no-ops without `children`, so raw-assertion cases need a child.
function makeTaskListItem(text: string, taskMarker: string): any {
	const checked = taskMarker.trim().toLowerCase() === '[x]';
	return {
		kind: 'listItem',
		leadingTrivia: '',
		raw: `- ${taskMarker}${text}\n`,
		metadata: { marker: '- ', taskItem: true, taskChecked: checked, taskMarker },
		innerPrefix: '',
		innerSuffix: '',
		children: [{ kind: 'paragraph', leadingTrivia: '', raw: `${text}\n` }]
	};
}

// ── Top-level scope ───────────────────────────────────────────────────────────

describe('updateBlockMetadata', () => {
	it('merges patch into node.metadata and emits one metadataUpdate event', async () => {
		const node = makeNode('paragraph', 'hello\n', { taskChecked: false });
		const { deps, events } = makeEditorActionsDeps([node]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);

		const editHandler = vi.fn();
		events.on('edit', editHandler);

		await actions.updateBlockMetadata(0, { taskChecked: true });

		// Copy-path-on-write: the captured pre-op node stays pristine for the snapshot sharing it.
		expect(deps.doc.children[0].metadata).toEqual({ taskChecked: true });
		expect(node.metadata).toEqual({ taskChecked: false });
		expect(editHandler).toHaveBeenCalledTimes(1);
		const evt = editHandler.mock.calls[0][0];
		expect(evt.op).toBe('metadataUpdate');
		expect(evt.path).toEqual([0]);
		expect(evt.detail.fields).toEqual(['taskChecked']);
	});

	it('pushes exactly one undo snapshot, and undo/redo flip metadata back and forth', async () => {
		const node = makeNode('paragraph', 'hello\n', { taskChecked: false });
		const { deps } = makeEditorActionsDeps([node]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);
		const history = createHistoryActions(deps, controller);

		await actions.updateBlockMetadata(0, { taskChecked: true });

		const stacks = deps.undoManager.getStacks();
		expect(stacks.undo).toHaveLength(1);
		expect(stacks.undo[0].snapshot.children[0].metadata).toEqual({ taskChecked: false });

		await history.requestUndo();
		expect(deps.doc.children[0].metadata).toEqual({ taskChecked: false });

		await history.requestRedo();
		expect(deps.doc.children[0].metadata).toEqual({ taskChecked: true });
	});

	it("undoEntry: 'join' — no undo snapshot pushed", async () => {
		const node = makeNode('paragraph', 'hello\n', { taskChecked: false });
		const { deps } = makeEditorActionsDeps([node]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);

		await actions.updateBlockMetadata(0, { taskChecked: true }, { undoEntry: 'join' });

		expect(deps.undoManager.getStacks().undo).toHaveLength(0);
		expect(node.metadata).toEqual({ taskChecked: true });
	});

	it('empty patch — no snapshot, no event, metadata unchanged', async () => {
		const node = makeNode('paragraph', 'hello\n', { taskChecked: false });
		const { deps, events } = makeEditorActionsDeps([node]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);

		const editHandler = vi.fn();
		events.on('edit', editHandler);

		await actions.updateBlockMetadata(0, {});

		expect(node.metadata).toEqual({ taskChecked: false });
		expect(editHandler).not.toHaveBeenCalled();
		expect(deps.undoManager.getStacks().undo).toHaveLength(0);
	});

	// A `noop` commit leaves the staleness oracle unable to infer the touched node, so the
	// top-level scope must name it or the resync gets zero G1.1/G1.12/G1.13 validation.
	it('names the resynced node for the dev oracle (parity with the container scope)', async () => {
		const node = makeNode('paragraph', 'hello\n', { taskChecked: false });
		const { deps } = makeEditorActionsDeps([node]);
		const controller = createUndoController(deps);
		const spy = vi.spyOn(controller, 'commitStructural');
		const actions = createBlockEditActions(deps, controller);

		await actions.updateBlockMetadata(0, { taskChecked: true });

		const args = spy.mock.calls[0][0];
		expect(args.touchedNodes).toBeDefined();
		expect(args.touchedNodes).toContain(deps.doc.children[0]);
	});

	it('runs the afterTick callback after committing (post-commit caret placement)', async () => {
		const node = makeNode('paragraph', 'hello\n', { taskChecked: false });
		const { deps } = makeEditorActionsDeps([node]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);

		const afterTick = vi.fn(() => {
			expect(deps.doc.children[0].metadata).toEqual({ taskChecked: true });
		});
		await actions.updateBlockMetadata(0, { taskChecked: true }, { afterTick });

		expect(afterTick).toHaveBeenCalledOnce();
	});

	it('skips afterTick when the patch is empty (no commit runs)', async () => {
		const node = makeNode('paragraph', 'hello\n', { taskChecked: false });
		const { deps } = makeEditorActionsDeps([node]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);

		const afterTick = vi.fn();
		await actions.updateBlockMetadata(0, {}, { afterTick });

		expect(afterTick).not.toHaveBeenCalled();
	});

	it('shallow-merge preserves untouched fields', async () => {
		// A switch to `node.metadata = metadata` (no spread) fails here. The fixture is a
		// registered leaf kind: kind-agnostic for the merge check, and the dev oracle validates it.
		const node = makeNode('paragraph', 'hello\n', {
			marker: '- ',
			taskItem: true,
			taskChecked: false
		});
		const { deps } = makeEditorActionsDeps([node]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);

		await actions.updateBlockMetadata(0, { taskChecked: true });

		expect(deps.doc.children[0].metadata).toEqual({
			marker: '- ',
			taskItem: true,
			taskChecked: true
		});
	});

	it('multi-field patch updates taskChecked and taskMarker atomically', async () => {
		const node = makeTaskListItem('pending', '[ ] ');
		const { deps, events } = makeEditorActionsDeps([node]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);

		const editHandler = vi.fn();
		events.on('edit', editHandler);

		await actions.updateBlockMetadata(0, { taskChecked: true, taskMarker: '[x] ' });

		expect(deps.doc.children[0].metadata).toMatchObject({
			taskItem: true,
			taskChecked: true,
			taskMarker: '[x] '
		});
		expect(deps.doc.children[0].raw).toBe('- [x] pending\n');
		expect(editHandler).toHaveBeenCalledTimes(1);
		const evt = editHandler.mock.calls[0][0];
		expect(evt.op).toBe('metadataUpdate');
		expect(evt.detail.fields).toEqual(expect.arrayContaining(['taskChecked', 'taskMarker']));
	});

	it('undo after multi-field task patch restores both fields', async () => {
		const node = makeTaskListItem('pending', '[ ] ');
		const { deps } = makeEditorActionsDeps([node]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);
		const history = createHistoryActions(deps, controller);

		await actions.updateBlockMetadata(0, { taskChecked: true, taskMarker: '[x] ' });
		await history.requestUndo();

		expect(deps.doc.children[0].metadata).toMatchObject({
			taskChecked: false,
			taskMarker: '[ ] '
		});
		expect(deps.doc.children[0].raw).toBe('- [ ] pending\n');
	});
});

// ── Container scope ───────────────────────────────────────────────────────────

function makeContainerSetup(containerIndex: number) {
	const innerNode = makeNode('paragraph', 'hello\n', {
		marker: '- ',
		taskItem: true,
		taskChecked: false
	});
	const containerNode: any = {
		kind: 'blockquote',
		leadingTrivia: '',
		raw: '> hello\n',
		children: [innerNode],
		innerPrefix: '> ',
		innerSuffix: ''
	};

	const padNode = makeNode('paragraph', 'pad\n', {});
	const docNodes = Array.from({ length: containerIndex }, () => padNode).concat([containerNode]);

	const { deps, events, controller, bundle } = makeNestedHarness(docNodes, {
		index: containerIndex
	});

	const liveInner = () => deps.doc.children[containerIndex].children![0];
	const liveContainer = () => deps.doc.children[containerIndex];
	return { bundle, innerNode, containerNode, liveInner, liveContainer, deps, events, controller };
}

describe('updateBlockMetadata — container scope', () => {
	it('mutates inner node metadata and emits metadataUpdate with correct eventPath and fields', async () => {
		const containerIndex = 2;
		const { bundle, liveInner, events } = makeContainerSetup(containerIndex);

		const editHandler = vi.fn();
		events.on('edit', editHandler);

		await bundle.blockEdit.updateBlockMetadata(0, { taskChecked: true });

		expect(liveInner().metadata).toMatchObject({ taskChecked: true });

		expect(editHandler).toHaveBeenCalledTimes(1);
		const evt = editHandler.mock.calls[0][0];
		expect(evt.op).toBe('metadataUpdate');
		expect(evt.path).toEqual([containerIndex, 0]);
		expect(evt.detail.fields).toEqual(['taskChecked']);
	});

	it(`undoEntry: 'join' — commitContainer called with "skip" sentinel (no snapshot pushed)`, async () => {
		const { bundle, deps } = makeContainerSetup(1);

		await bundle.blockEdit.updateBlockMetadata(0, { taskChecked: true }, { undoEntry: 'join' });

		expect(deps.undoManager.getStacks().undo).toHaveLength(0);
	});

	it('empty patch — early-returns with no commitContainer call and no snapshot', async () => {
		const containerIndex = 1;
		const { bundle, deps, events } = makeContainerSetup(containerIndex);

		const editHandler = vi.fn();
		events.on('edit', editHandler);

		await bundle.blockEdit.updateBlockMetadata(0, {});

		expect(editHandler).not.toHaveBeenCalled();
		expect(deps.undoManager.getStacks().undo).toHaveLength(0);
	});

	it('shallow-merge preserves untouched fields', async () => {
		const { bundle, liveInner } = makeContainerSetup(1);

		await bundle.blockEdit.updateBlockMetadata(0, { taskChecked: true });

		expect(liveInner().metadata).toEqual({ marker: '- ', taskItem: true, taskChecked: true });
	});

	it('task taskMarker patch rebuilds inner listItem raw AND parent list raw', async () => {
		// Without the ceremony's ancestry rebuild the inner listItem.raw updates while the
		// list's composite raw stays stale.
		const { bundle, liveInner, liveContainer } = makeListContainerSetup(1);

		await bundle.blockEdit.updateBlockMetadata(0, { taskChecked: true, taskMarker: '[x] ' });

		expect(liveInner().raw).toBe('- [x] pending\n');
		expect(liveContainer().raw).toBe('- [x] pending\n');
	});
});

// ── List-container scope helper ──────────────────────────────────────────────

function makeListContainerSetup(containerIndex: number) {
	const innerNode = makeTaskListItem('pending', '[ ] ');
	const containerNode: any = {
		kind: 'list',
		leadingTrivia: '',
		raw: '- [ ] pending\n',
		metadata: { ordered: false },
		innerPrefix: '',
		innerSuffix: '',
		children: [innerNode]
	};

	const padNode = makeNode('paragraph', 'pad\n', {});
	const docNodes = Array.from({ length: containerIndex }, () => padNode).concat([containerNode]);

	const { deps, events, controller, bundle } = makeNestedHarness(docNodes, {
		index: containerIndex
	});

	const liveInner = () => deps.doc.children[containerIndex].children![0];
	const liveContainer = () => deps.doc.children[containerIndex];
	return { bundle, innerNode, containerNode, liveInner, liveContainer, deps, events, controller };
}
