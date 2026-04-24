import { describe, it, expect, vi } from 'vitest';
import { createUndoController } from '$lib/editor/editor-actions/undo-controller';
import { createBlockEditActions } from '$lib/editor/editor-actions/block-edit';
import { createContainerEditActions } from '$lib/editor/editor-actions/container-edit';
import { createStandardNestedActions } from '$lib/editor/editor-actions/nested-actions';
import { createBlockListState } from '$lib/editor/block-list-state.svelte';
import { createUndoManager } from '$lib/editor/undo-manager';
import { createSelectionState } from '$lib/editor/selection/selection-state.svelte';
import { createEditorEvents } from '$lib/editor/events/editor-events';
import type {
	BlockComponent,
	BlockEditActions,
	FocusActions,
	CstNode
} from '$lib/editor/contracts';
import type { StickyColumnState } from '$lib/editor/cursor/sticky-column';

// ── Harness helpers ───────────────────────────────────────────────────────────

function mockRef(): BlockComponent {
	return {
		focus: () => {},
		getCursorOffset: () => null,
		editable: true,
		focusable: true
	} as BlockComponent;
}

function makeStickyColumn(): StickyColumnState {
	return { get: () => null, reset: vi.fn(), capture: vi.fn() };
}

function makeNode(kind: string, raw: string): CstNode {
	return { kind, leadingTrivia: '', raw } as CstNode;
}

function makeDeps(nodes: CstNode[]) {
	const doc: any = { kind: 'document', children: nodes };
	let blockIds = nodes.map((_, i) => `id-${i}`);
	let blockRefs: (BlockComponent | undefined)[] = nodes.map(() => mockRef());
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
			setBlockIds: (v: string[]) => {
				blockIds = v;
			},
			setBlockRefs: (v: (BlockComponent | undefined)[]) => {
				blockRefs = v;
			},
			undoManager: createUndoManager(),
			stickyColumn: makeStickyColumn(),
			selectionState: createSelectionState(),
			getBlockElByPath: () => null,
			events
		},
		doc,
		getBlockIds: () => blockIds,
		getBlockRefs: () => blockRefs
	};
}

// ── B2: top-level replaceBlock preserves id ──────────────────────────────────

describe('top-level replaceBlock id preservation', () => {
	it('first replacement inherits the original block id (single replacement)', async () => {
		const original = makeNode('paragraph', 'hello\n');
		const { deps, getBlockIds } = makeDeps([original]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);

		const originalId = getBlockIds()[0];

		await actions.replaceBlock(0, [makeNode('paragraph', 'world\n')]);

		const ids = getBlockIds();
		expect(ids).toHaveLength(1);
		expect(ids[0]).toBe(originalId);
	});

	it('first replacement inherits the original block id when expanding to multiple blocks', async () => {
		const original = makeNode('paragraph', 'a\n');
		const sibling = makeNode('paragraph', 'b\n');
		const { deps, getBlockIds } = makeDeps([original, sibling]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);

		const originalId = getBlockIds()[0];
		const siblingId = getBlockIds()[1];

		await actions.replaceBlock(0, [makeNode('paragraph', 'x\n'), makeNode('paragraph', 'y\n')]);

		const ids = getBlockIds();
		expect(ids).toHaveLength(3);
		expect(ids[0]).toBe(originalId);
		expect(ids[1]).not.toBe(originalId);
		expect(ids[1]).not.toBe(siblingId);
		expect(ids[2]).toBe(siblingId);
	});

	it('preserves the block ref alongside the id (component is not destroyed/recreated)', async () => {
		const original = makeNode('paragraph', 'a\n');
		const { deps, getBlockRefs } = makeDeps([original]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);

		const originalRef = getBlockRefs()[0];

		await actions.replaceBlock(0, [makeNode('paragraph', 'b\n')]);

		expect(getBlockRefs()[0]).toBe(originalRef);
	});

	it('empty replacement (delete) does not need id preservation', async () => {
		const original = makeNode('paragraph', 'a\n');
		const sibling = makeNode('paragraph', 'b\n');
		const { deps, getBlockIds } = makeDeps([original, sibling]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);

		const siblingId = getBlockIds()[1];

		await actions.replaceBlock(0, []);

		const ids = getBlockIds();
		expect(ids).toHaveLength(1);
		expect(ids[0]).toBe(siblingId);
	});
});

// ── B3 + B10: nested replaceBlock id preservation + ensureEditableContainers ─

function makeNestedSetup() {
	const innerPara = makeNode('paragraph', 'hello\n');
	const containerNode: CstNode = {
		kind: 'blockquote',
		leadingTrivia: '',
		raw: '> hello\n',
		children: [innerPara],
		innerPrefix: '> ',
		innerSuffix: ''
	} as CstNode;

	const { deps } = makeDeps([containerNode]);
	const controller = createUndoController(deps);
	const containerEditActions = createContainerEditActions(deps, controller);

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
		index: 0,
		get node() {
			return containerNode;
		},
		rebuildRaw: vi.fn(),
		stickyColumn: makeStickyColumn(),
		parent: {
			blockEdit: parentBlockEdit,
			focus: parentFocus,
			containerEdit: containerEditActions
		}
	});

	return { bundle, containerNode, containerState, deps };
}

describe('nested replaceBlock id preservation', () => {
	it('first inner replacement inherits the original inner block id', async () => {
		const { bundle, containerState } = makeNestedSetup();
		const originalInnerId = containerState.innerBlockIds[0];

		await bundle.blockEdit.replaceBlock(0, [makeNode('paragraph', 'world\n')]);

		expect(containerState.innerBlockIds).toHaveLength(1);
		expect(containerState.innerBlockIds[0]).toBe(originalInnerId);
	});

	it('expansion to multiple blocks: first inherits, others get fresh ids', async () => {
		const { bundle, containerState } = makeNestedSetup();
		const originalInnerId = containerState.innerBlockIds[0];

		await bundle.blockEdit.replaceBlock(0, [
			makeNode('paragraph', 'x\n'),
			makeNode('paragraph', 'y\n')
		]);

		expect(containerState.innerBlockIds).toHaveLength(2);
		expect(containerState.innerBlockIds[0]).toBe(originalInnerId);
		expect(containerState.innerBlockIds[1]).not.toBe(originalInnerId);
	});
});

describe('nested replaceBlock ensureEditableContainers (B10)', () => {
	it('synthesized empty list/listItem replacement gets a child paragraph cursor target', async () => {
		const { bundle, containerNode } = makeNestedSetup();

		// Synthesize a list with an empty listItem — no child paragraph would
		// leave the cursor with nowhere to land. ensureEditableContainers must
		// backfill the inner paragraph during the splice.
		const synthList: CstNode = {
			kind: 'list',
			leadingTrivia: '',
			raw: '',
			metadata: { ordered: false },
			children: [
				{
					kind: 'listItem',
					leadingTrivia: '',
					raw: '',
					metadata: { marker: '- ', taskItem: false, taskChecked: false },
					innerPrefix: '',
					children: [],
					innerSuffix: ''
				} as CstNode
			]
		} as CstNode;

		await bundle.blockEdit.replaceBlock(0, [synthList]);

		const placedList = containerNode.children?.[0];
		expect(placedList?.kind).toBe('list');
		const listItem = placedList?.children?.[0];
		expect(listItem?.kind).toBe('listItem');
		expect(listItem?.children?.length).toBeGreaterThan(0);
		expect(listItem?.children?.[0].kind).toBe('paragraph');
	});
});
