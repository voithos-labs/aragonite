// Deleting a sole table empties the document, so the coverage delete materializes
// a caret placeholder in the same commit. That placeholder IS a line ending, and
// with nothing surviving there is no block left to read one from — the ending must
// be captured before the delete or a CRLF document silently becomes LF (G4.20).
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { maybeCommitTableCoverageDelete } from '$lib/selection/range-delete-table-coverage';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import { makeBlockListState, makeEditorActionsDeps } from '../harness/editor-actions';
import type { CrossBlockMutationContext } from '$lib/selection/cross-block/ops';
import type { SelectionPoint } from '$lib/selection/primitives';

function soleTableEnv(source: string) {
	const { deps } = makeEditorActionsDeps(parse(source).children);
	const table = deps.doc.children[0];
	registerBlockListState(
		table,
		makeBlockListState(() => deps.doc.children[0])
	);
	const controller = createUndoController(deps);
	const ctx: CrossBlockMutationContext = {
		selection: deps.selectionState,
		getDoc: () => deps.doc,
		getBlockElByPath: () => null,
		revealPath: deps.revealPath,
		controller,
		pushUndoSnapshot: () => controller.pushUndoSnapshot(0, 0),
		grammar: undefined
	};
	return { deps, table, ctx };
}

// 2 columns × 2 rows: cell indices 0..3, so a whole-table selection is [0, 3].
const TABLE = (ending: string) => ['| a | b |', '| --- | --- |', '| c | d |', ''].join(ending);

async function deleteWholeTable(source: string): Promise<string> {
	const { deps, table, ctx } = soleTableEnv(source);
	const start: SelectionPoint = { path: [0], offset: 0 };
	const end: SelectionPoint = { path: [0], offset: 3 };
	deps.selectionState.enterCrossBlock(start, end);

	const result = await maybeCommitTableCoverageDelete(ctx, table, start, end, undefined, undefined);
	expect(result).not.toBeNull();
	return serialize(deps.doc);
}

describe('coverage-driven whole-table delete keeps the document line ending', () => {
	it('a sole CRLF table leaves a CRLF placeholder', async () => {
		expect(await deleteWholeTable(TABLE('\r\n'))).toBe('\r\n');
	});

	it('a sole LF table still leaves an LF placeholder', async () => {
		expect(await deleteWholeTable(TABLE('\n'))).toBe('\n');
	});
});
