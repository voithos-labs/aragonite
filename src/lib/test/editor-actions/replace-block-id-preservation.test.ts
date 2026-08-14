import { describe, it, expect, afterEach } from 'vitest';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { parse } from '$lib/core/parser';
import {
	makeEditorActionsDeps,
	makeNestedHarness,
	makeNode
} from '$lib/test/harness/editor-actions';
import type { CstNode } from '$lib/core/nodes';
import { allowDevWarns } from '$lib/test/support/warn-gate';

// The synthesized replacement containers are minted without a rebuilt raw, which is what the
// oracle reports.
afterEach(() => allowDevWarns(['invariant:stale-raw']));

// ── Top-level replaceBlock preserves id ──────────────────────────────────────

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

// ── Nested replaceBlock id preservation + ensureEditableContainers ───────────

function makeNestedSetup() {
	const innerPara = makeNode('paragraph', 'hello\n');
	const containerNode: CstNode = {
		kind: 'blockquote',
		leadingTrivia: '',
		raw: '> hello\n',
		children: [innerPara],
		innerPrefix: '',
		innerSuffix: ''
	} as CstNode;

	const { deps, bundle, state: containerState } = makeNestedHarness([containerNode]);

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

describe('nested replaceBlock ensureEditableContainers', () => {
	it('synthesized empty list/listItem replacement gets a child paragraph cursor target', async () => {
		const { bundle, deps } = makeNestedSetup();

		// An empty listItem leaves the cursor nowhere to land, so ensureEditableContainers
		// must backfill the inner paragraph during the splice.
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
					metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null },
					innerPrefix: '',
					children: [],
					innerSuffix: ''
				} as CstNode
			]
		} as CstNode;

		await bundle.blockEdit.replaceBlock(0, [synthList]);

		// The commit replaced the container node, so read through the live doc.
		const placedList = deps.doc.children[0].children?.[0];
		expect(placedList?.kind).toBe('list');
		const listItem = placedList?.children?.[0];
		expect(listItem?.kind).toBe('listItem');
		expect(listItem?.children?.length).toBeGreaterThan(0);
		expect(listItem?.children?.[0].kind).toBe('paragraph');
	});
});

// ── List-overrides replaceBlock preserves the surviving item's id ────────────

// A changed id destroys and recreates the component, losing IME / pending input.
function makeListSetup() {
	const listNode = parse('- a\n- b\n').children[0];
	expect(listNode.kind).toBe('list');

	const { bundle, state: listState } = makeNestedHarness([listNode], { listOverrides: true });

	return { bundle, listNode, listState };
}

describe('list-overrides replaceBlock id preservation', () => {
	it('surviving first item inherits its original id (single replacement)', async () => {
		const { bundle, listState } = makeListSetup();
		const originalFirstId = listState.innerBlockIds[0];
		const originalSecondId = listState.innerBlockIds[1];
		const replacement = parse('- replaced\n').children[0].children![0];

		await bundle.blockEdit.replaceBlock(0, [replacement]);

		expect(listState.innerBlockIds).toHaveLength(2);
		expect(listState.innerBlockIds[0]).toBe(originalFirstId);
		expect(listState.innerBlockIds[1]).toBe(originalSecondId);
	});

	it('expansion: first item inherits, additional items get fresh ids', async () => {
		const { bundle, listState } = makeListSetup();
		const originalFirstId = listState.innerBlockIds[0];
		const originalSecondId = listState.innerBlockIds[1];
		const expansion = parse('- x\n- y\n').children[0].children!;

		await bundle.blockEdit.replaceBlock(0, expansion);

		expect(listState.innerBlockIds).toHaveLength(3);
		expect(listState.innerBlockIds[0]).toBe(originalFirstId);
		expect(listState.innerBlockIds[1]).not.toBe(originalFirstId);
		expect(listState.innerBlockIds[1]).not.toBe(originalSecondId);
		expect(listState.innerBlockIds[2]).toBe(originalSecondId);
	});
});
