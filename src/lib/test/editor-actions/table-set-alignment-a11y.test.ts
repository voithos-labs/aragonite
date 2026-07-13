import { describe, it, expect, vi } from 'vitest';
import { createTableMutationsContext } from '$lib/editor-actions/table-context';
import { createContainerEditActions } from '$lib/editor-actions/container-edit';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { parse } from '$lib/core/parser';
import { makeBlockListState, makeEditorActionsDeps } from '../harness/editor-actions';
import type { BlockListState } from '$lib/reactivity/block-list-state.svelte';

// Regression (a11y): choosing an alignment from the table menu dropped keyboard
// focus to <body> and announced nothing. setColumnAlignment now refocuses the
// originating cell and announces via the live region.

const TABLE = '| a | b |\n| --- | --- |\n| c | d |\n';

function mutationsFor(focusedCell: { rowIdx: number; colIdx: number } | null) {
	const { deps } = makeEditorActionsDeps([parse(TABLE).children[0]]);
	const liveTable = () => deps.doc.children[0];
	const rowsState = makeBlockListState(liveTable, ['row-0', 'row-1']) as unknown as BlockListState;
	const controller = createUndoController(deps);
	const focusCell = vi.fn();
	const announceReorder = vi.fn();
	const mutations = createTableMutationsContext({
		get node() {
			return liveTable();
		},
		get myPath() {
			return [0];
		},
		get rowsState() {
			return rowsState;
		},
		get focusedCell() {
			return focusedCell;
		},
		parentContainerEdit: createContainerEditActions(deps, controller),
		controller,
		focusCell,
		announceReorder
	});
	return { mutations, focusCell, announceReorder };
}

describe('setColumnAlignment — focus restore + announcement', () => {
	it('refocuses the originating cell in the aligned column and announces', async () => {
		const { mutations, focusCell, announceReorder } = mutationsFor({ rowIdx: 1, colIdx: 1 });

		await mutations.setColumnAlignment(1, 'center');

		expect(focusCell).toHaveBeenCalledWith(1, 1, 'start');
		expect(announceReorder).toHaveBeenCalledWith('Column aligned center');
	});

	it('falls back to row 0 of the aligned column when no cell is focused (menu-driven)', async () => {
		const { mutations, focusCell, announceReorder } = mutationsFor(null);

		await mutations.setColumnAlignment(0, 'right');

		expect(focusCell).toHaveBeenCalledWith(0, 0, 'start');
		expect(announceReorder).toHaveBeenCalledWith('Column aligned right');
	});
});
