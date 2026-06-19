import { describe, it, expect, vi } from 'vitest';
import { createHistoryActions } from '$lib/editor/editor-actions/history';
import { createUndoController } from '$lib/editor/editor-actions/undo-controller';
import { makeEditorActionsDeps } from '$lib/editor/test/harness/editor-actions';
import type { CstNode } from '$lib/editor/core/nodes';

function makeNode(kind: string, raw: string): CstNode {
	return { kind, leadingTrivia: '', raw } as CstNode;
}

function makeSetup() {
	const { deps } = makeEditorActionsDeps([makeNode('paragraph', 'aaa\n')]);
	const controller = createUndoController(deps);
	const clearSpy = vi.spyOn(controller, 'clearDebouncedCheckpoint');
	return { history: createHistoryActions(deps, controller), clearSpy };
}

// Both swap entry points must drop an armed keystroke batch before reading the
// stack, so a pending debounce timer can't push a snapshot after the swap. The
// stacks are empty here, so both calls no-op after the clear — discriminating
// on whether the clear ran, not on a restore.
describe('history swap clears the debounce batch', () => {
	it('requestUndo clears the debounced checkpoint', async () => {
		const { history, clearSpy } = makeSetup();
		await history.requestUndo();
		expect(clearSpy).toHaveBeenCalledTimes(1);
	});

	it('requestRedo clears the debounced checkpoint, symmetric with undo', async () => {
		const { history, clearSpy } = makeSetup();
		await history.requestRedo();
		expect(clearSpy).toHaveBeenCalledTimes(1);
	});
});
