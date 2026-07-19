import { describe, it, expect } from 'vitest';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createContainerEditActions } from '$lib/editor-actions/container-edit';
import { createStandardNestedActions } from '$lib/editor-actions/nested/nested-actions';
import { createBlockListState } from '$lib/reactivity/block-list-state.svelte';
import {
	makeStickyColumn,
	makeStubBlockEdit,
	makeStubFocus,
	makeEditorActionsDeps
} from '$lib/test/harness/editor-actions';
import type { CstNode } from '$lib/core/nodes';

function makeContainer(childRaws: string[]): CstNode {
	return {
		kind: 'blockquote',
		leadingTrivia: '',
		raw: childRaws.map((r) => `> ${r}`).join(''),
		children: childRaws.map((r) => ({
			kind: 'paragraph',
			leadingTrivia: '',
			raw: r
		})) as CstNode[],
		innerPrefix: '> ',
		innerSuffix: ''
	} as CstNode;
}

function makeSetup(childRaws: string[]) {
	const containerNode = makeContainer(childRaws);
	const { deps } = makeEditorActionsDeps([containerNode]);

	const controller = createUndoController(deps);
	const containerEditActions = createContainerEditActions(deps, controller);

	const containerState = createBlockListState(() => deps.doc.children[0]);
	const bundle = createStandardNestedActions(containerState, {
		index: 0,
		get node() {
			return deps.doc.children[0];
		},
		path: [0],
		stickyColumn: makeStickyColumn(),
		parent: {
			blockEdit: makeStubBlockEdit(),
			focus: makeStubFocus(),
			containerEdit: containerEditActions
		}
	});

	return { bundle, containerNode, containerState, controller, deps };
}

// ── Debounce batches break on focus change between sibling leaves ─────────────

describe('debounce batch key — sibling leaves inside one container', () => {
	it('typing in leaf 0 then leaf 1 produces two undo entries (focus break)', async () => {
		const { bundle, controller, deps } = makeSetup(['hello\n', 'world\n']);

		// Simulate typing 1 char into leaf 0 — first stroke pushes a snapshot.
		await bundle.blockEdit.updateBlockContent(0, 'hello1\n', 5);
		// Simulate "focus moved to leaf 1, then typed" — the new leaf's id key
		// must break the batch even though no checkpoint is pending (text-batch
		// needsCheckpoint still false).
		await bundle.blockEdit.updateBlockContent(1, 'world1\n', 5);

		// Two snapshots: one before each leaf's typing batch.
		expect(deps.undoManager.getStacks().undo).toHaveLength(2);
		// Cleanup the still-pending debounce timer so vitest exits cleanly.
		controller.flushDebouncedCheckpoint();
	});

	it('typing in leaf 0, leaf 1, then leaf 0 again produces three undo entries', async () => {
		const { bundle, controller, deps } = makeSetup(['a\n', 'b\n', 'c\n']);

		await bundle.blockEdit.updateBlockContent(0, 'a1\n', 1);
		await bundle.blockEdit.updateBlockContent(1, 'b1\n', 1);
		await bundle.blockEdit.updateBlockContent(0, 'a12\n', 2);

		expect(deps.undoManager.getStacks().undo).toHaveLength(3);
		controller.flushDebouncedCheckpoint();
	});

	it('typing repeatedly into the same leaf still produces one batch (no spurious breaks)', async () => {
		const { bundle, controller, deps } = makeSetup(['hi\n', 'yo\n']);

		await bundle.blockEdit.updateBlockContent(0, 'hi1\n', 2);
		await bundle.blockEdit.updateBlockContent(0, 'hi12\n', 3);
		await bundle.blockEdit.updateBlockContent(0, 'hi123\n', 4);

		expect(deps.undoManager.getStacks().undo).toHaveLength(1);
		controller.flushDebouncedCheckpoint();
	});
});
