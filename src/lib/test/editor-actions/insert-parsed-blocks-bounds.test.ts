import { describe, it, expect } from 'vitest';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { parse } from '$lib/core/parser';
import { makeEditorActionsDeps } from '../harness/editor-actions';

// Regression: the top-level insertParsedBlocks had no bounds guard, so an
// out-of-range blockIndex reached foldPasteReplacement(children[i] /* undefined */)
// and threw an uncontained TypeError — the container path already no-ops.

describe('top-level insertParsedBlocks — bounds parity', () => {
	it('no-ops on an out-of-range blockIndex instead of throwing', async () => {
		const { deps } = makeEditorActionsDeps([parse('hello\n').children[0]]);
		const actions = createBlockEditActions(deps, createUndoController(deps));
		const blocks = parse('one\n\ntwo\n').children;

		await expect(actions.insertParsedBlocks(5, 0, blocks)).resolves.toBeUndefined();
		expect(deps.doc.children).toHaveLength(1);
		expect(deps.doc.children[0].raw).toBe('hello\n');
	});
});
