import { describe, it, expect, vi, type Mock } from 'vitest';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { createContainerEditActions } from '$lib/editor-actions/container-edit';
import { createStandardNestedActions } from '$lib/editor-actions/nested/nested-actions';
import { createBlockListState } from '$lib/reactivity/block-list-state.svelte';
import {
	makeNestedActionsDeps,
	makeStubBlockEdit,
	makeStubFocus,
	makeEditorActionsDeps,
	makeNode
} from '$lib/test/harness/editor-actions';
import type { EditEvent } from '$lib/editor-events';
import type { CstNode } from '$lib/core/nodes';

// G2.9 paste op-kind dual-emit. A paste surfaces a DIFFERENT op kind depending
// on depth: top-level insertParsedBlocks emits `paste`, a paste into a container
// emits `replaceBlock` (it routes through the nested replaceBlock path). Both
// matter — a consumer watching only one kind misses half the pastes — so each
// case asserts its kind fires AND the other does not.

function editKinds(handler: Mock<(e: EditEvent) => void>): string[] {
	return handler.mock.calls.map(([event]) => event.op);
}

describe('G2.9 paste op-kind dual-emit', () => {
	it('top-level paste emits paste, not replaceBlock', async () => {
		const { deps, events } = makeEditorActionsDeps([makeNode('paragraph', 'hello\n')]);
		const controller = createUndoController(deps);
		const actions = createBlockEditActions(deps, controller);

		const onEdit = vi.fn<(e: EditEvent) => void>();
		events.on('edit', onEdit);

		await actions.insertParsedBlocks(0, 3, [makeNode('paragraph', 'pasted\n')]);

		const kinds = editKinds(onEdit);
		expect(kinds).toContain('paste');
		expect(kinds).not.toContain('replaceBlock');
	});

	it('paste into a container emits replaceBlock, not paste', async () => {
		const innerPara = makeNode('paragraph', 'hello\n');
		const containerNode: CstNode = {
			kind: 'blockquote',
			leadingTrivia: '',
			raw: '> hello\n',
			children: [innerPara],
			innerPrefix: '> ',
			innerSuffix: ''
		} as CstNode;

		const { deps, events } = makeEditorActionsDeps([containerNode]);
		const controller = createUndoController(deps);
		const containerEdit = createContainerEditActions(deps, controller);
		const containerState = createBlockListState(() => containerNode);

		const bundle = createStandardNestedActions(
			containerState,
			makeNestedActionsDeps({
				index: 0,
				getNode: () => containerNode,
				path: [0],
				parent: { blockEdit: makeStubBlockEdit(), focus: makeStubFocus(), containerEdit }
			})
		);

		const onEdit = vi.fn<(e: EditEvent) => void>();
		events.on('edit', onEdit);

		await bundle.blockEdit.insertParsedBlocks(0, 3, [makeNode('paragraph', 'pasted\n')]);

		const kinds = editKinds(onEdit);
		expect(kinds).toContain('replaceBlock');
		expect(kinds).not.toContain('paste');
	});
});
