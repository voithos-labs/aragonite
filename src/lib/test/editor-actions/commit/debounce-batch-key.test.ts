import { describe, it, expect } from 'vitest';
import { makeEditorActionsDeps, makeNestedHarness } from '$lib/test/harness/editor-actions';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { parse } from '$lib/core/parser';
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
		innerPrefix: '',
		innerSuffix: ''
	} as CstNode;
}

function makeSetup(childRaws: string[]) {
	const containerNode = makeContainer(childRaws);
	const { deps, controller, state: containerState, bundle } = makeNestedHarness([containerNode]);
	return { bundle, containerNode, containerState, controller, deps };
}

// ── Debounce batches break on focus change between sibling leaves ─────────────

describe('debounce batch key — sibling leaves inside one container', () => {
	it('typing in leaf 0 then leaf 1 produces two undo entries (focus break)', async () => {
		const { bundle, controller, deps } = makeSetup(['hello\n', 'world\n']);

		await bundle.blockEdit.updateBlockContent(0, 'hello1\n', 5);
		// The new leaf's id key must break the batch even though no checkpoint is
		// pending (text-batch `needsCheckpoint` is still false here).
		await bundle.blockEdit.updateBlockContent(1, 'world1\n', 5);

		expect(deps.undoManager.getStacks().undo).toHaveLength(2);
		// Clear the still-pending debounce timer so vitest exits cleanly.
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

// ── The same rule one level up ───────────────────────────────────────────────

describe('debounce batch key — top-level blocks', () => {
	it('a different block arriving at the same slot breaks the batch', async () => {
		const { deps } = makeEditorActionsDeps(parse('a\n\nb\n').children);
		const controller = createUndoController(deps);
		const blockEdit = createBlockEditActions(deps, controller);

		await blockEdit.updateBlockContent(0, 'a1\n', 1);
		// A slot-keyed batch cannot see this and folds the next keystroke into the
		// previous block's undo entry.
		deps.setBlockIds(['block-new', deps.blockIds[1]]);
		await blockEdit.updateBlockContent(0, 'x1\n', 1);

		expect(deps.undoManager.getStacks().undo).toHaveLength(2);
		controller.flushDebouncedCheckpoint();
	});
});
