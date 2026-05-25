import { describe, it, expect, vi } from 'vitest';
import { createUndoController } from '$lib/editor/editor-actions/undo-controller';
import { createBlockEditActions } from '$lib/editor/editor-actions/block-edit';
import { createContainerEditActions } from '$lib/editor/editor-actions/container-edit';
import { createStandardNestedActions } from '$lib/editor/editor-actions/nested-actions';
import { createBlockListState } from '$lib/editor/reactivity/block-list-state.svelte';
import {
	makeStickyColumn,
	makeStubBlockEdit,
	makeStubFocus,
	makeEditorActionsDeps
} from '$lib/editor/test/harness/editor-actions';
import type { CstNode } from '$lib/editor/core/nodes';

function makeNode(kind: string, raw: string): CstNode {
	return { kind, leadingTrivia: '', raw } as CstNode;
}

// ── B2: top-level replaceBlock preserves id ──────────────────────────────────

describe('top-level replaceBlock id preservation', () => {
	it('first replacement inherits the original block id (single replacement)', async () => {
		const original = makeNode('paragraph', 'hello\n');
		const { deps, getBlockIds } = makeEditorActionsDeps([original]);
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
		const { deps, getBlockIds } = makeEditorActionsDeps([original, sibling]);
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
		const { deps, getBlockRefs } = makeEditorActionsDeps([original]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);

		const originalRef = getBlockRefs()[0];

		await actions.replaceBlock(0, [makeNode('paragraph', 'b\n')]);

		expect(getBlockRefs()[0]).toBe(originalRef);
	});

	it('empty replacement (delete) does not need id preservation', async () => {
		const original = makeNode('paragraph', 'a\n');
		const sibling = makeNode('paragraph', 'b\n');
		const { deps, getBlockIds } = makeEditorActionsDeps([original, sibling]);
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

	const { deps } = makeEditorActionsDeps([containerNode]);
	const controller = createUndoController(deps);
	const containerEditActions = createContainerEditActions(deps, controller);

	const containerState = createBlockListState(() => containerNode);
	const bundle = createStandardNestedActions(containerState, {
		index: 0,
		get node() {
			return containerNode;
		},
		rebuildRaw: vi.fn(),
		stickyColumn: makeStickyColumn(),
		parent: {
			blockEdit: makeStubBlockEdit(),
			focus: makeStubFocus(),
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
